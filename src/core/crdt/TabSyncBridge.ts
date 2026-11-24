/**
 * Cross-tab CRDT relay over native `BroadcastChannel`.
 *
 * Protocol:
 *   - `SYNC_STEP_1` carries `Y.encodeStateVector(ydoc)`.
 *   - `SYNC_STEP_2` carries `Y.encodeStateAsUpdate(ydoc, remoteVector)`, the
 *     exact missing delta for the requester.
 *   - `update` carries incremental local edits.
 *   - `branch` carries active-branch change notifications for UI mirroring.
 *
 * Every remote update is applied with the `"broadcast"` origin. The local
 * update listener ignores `"broadcast"` and y-indexeddb origins, so received
 * state and IndexedDB replays are never echoed back onto the channel.
 */

import { applyUpdate, encodeStateAsUpdate, encodeStateVector } from "yjs";
import type { Doc } from "yjs";

export const DEFAULT_SYNC_CHANNEL = "chronicle-crdt-sync";

/** Origin attached to every update received from another tab. */
export const BROADCAST_ORIGIN = "broadcast";

export interface SyncStep1Message {
  type: "SYNC_STEP_1";
  stateVector: Uint8Array;
}

export interface SyncStep2Message {
  type: "SYNC_STEP_2";
  update: Uint8Array;
}

export interface SyncUpdateMessage {
  type: "update";
  update: Uint8Array;
}

export interface SyncBranchMessage {
  type: "branch";
  branch: string | null;
}

export type SyncMessage =
  | SyncStep1Message
  | SyncStep2Message
  | SyncUpdateMessage
  | SyncBranchMessage;

/** Structural subset of BroadcastChannel, injectable in tests. */
export interface SyncChannel {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  close(): void;
}

export interface TabSyncBridgeOptions {
  /** Channel name; defaults to `chronicle-crdt-sync`. */
  channelName?: string;
  /** Inject a channel (tests, workers, or a custom transport). */
  channel?: SyncChannel;
  /** The y-indexeddb instance whose replays must not be re-broadcast. */
  persistence?: unknown;
  /**
   * Wait for local persistence before announcing the state vector. Prevents a
   * fresh tab from answering a handshake with an empty, not-yet-hydrated doc.
   */
  ready?: Promise<unknown>;
  /** Tests can disable the automatic startup handshake. */
  autoStart?: boolean;
  /** Notified when another tab announces a branch change. */
  onBranchChange?: (branch: string | null) => void;
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function parseMessage(value: unknown): SyncMessage | null {
  if (typeof value !== "object" || value === null) return null;

  const message = value as Record<string, unknown>;

  switch (message.type) {
    case "SYNC_STEP_1": {
      const stateVector = toUint8Array(message.stateVector);
      return stateVector ? { type: "SYNC_STEP_1", stateVector } : null;
    }
    case "SYNC_STEP_2": {
      const update = toUint8Array(message.update);
      return update ? { type: "SYNC_STEP_2", update } : null;
    }
    case "update": {
      const update = toUint8Array(message.update);
      return update ? { type: "update", update } : null;
    }
    case "branch":
      return {
        type: "branch",
        branch: typeof message.branch === "string" ? message.branch : null,
      };
    default:
      return null;
  }
}

export class TabSyncBridge {
  readonly doc: Doc;
  readonly channel: SyncChannel;
  readonly channelName: string;

  private readonly persistenceOrigin: unknown;
  private readonly onBranchChange: ((branch: string | null) => void) | null;
  private readonly ready: Promise<void> | null;
  private started = false;
  private readyResolved = false;
  private destroyed = false;
  private pendingMessages: SyncMessage[] = [];
  private activeBranch: string | null = null;

  constructor(doc: Doc, options: TabSyncBridgeOptions = {}) {
    this.doc = doc;
    this.channelName = options.channelName ?? DEFAULT_SYNC_CHANNEL;
    this.channel = options.channel ?? new BroadcastChannel(this.channelName);
    this.persistenceOrigin = options.persistence ?? null;
    this.onBranchChange = options.onBranchChange ?? null;
    this.ready = options.ready
      ? Promise.resolve(options.ready).then(() => undefined)
      : null;

    this.doc.on("update", this.onDocUpdate);
    this.channel.addEventListener("message", this.onChannelMessage);

    if (options.autoStart !== false) void this.start();
  }

  /** Branch last announced by another tab (or by this bridge locally). */
  get activeBranchName(): string | null {
    return this.activeBranch;
  }

  /**
   * Begins the handshake: waits for local persistence, replays any messages
   * queued during startup, then asks peers for everything this doc is missing.
   */
  async start(): Promise<void> {
    if (this.started || this.destroyed) return;
    this.started = true;

    if (this.ready) await this.ready;
    if (this.destroyed) return;

    this.readyResolved = true;
    const pending = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of pending) this.handleMessage(message);

    this.postSyncStep1();
  }

  /** Re-sends `SYNC_STEP_1` after startup (e.g. after a reconnect). */
  requestSync(): void {
    if (!this.readyResolved || this.destroyed) return;
    this.postSyncStep1();
  }

  /** Relays an active-branch change to every other open tab. */
  broadcastBranchChange(branch: string | null): void {
    this.activeBranch = branch;
    if (this.destroyed) return;
    this.channel.postMessage({
      type: "branch",
      branch,
    } satisfies SyncBranchMessage);
  }

  /** Detaches listeners and closes the channel. */
  stop(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off("update", this.onDocUpdate);
    this.channel.removeEventListener("message", this.onChannelMessage);
    this.channel.close();
    this.pendingMessages = [];
  }

  private postSyncStep1(): void {
    this.channel.postMessage({
      type: "SYNC_STEP_1",
      stateVector: encodeStateVector(this.doc),
    } satisfies SyncStep1Message);
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.destroyed) return;

    // Never echo remote or persisted state back onto the channel.
    if (origin === BROADCAST_ORIGIN || origin === this) return;
    if (this.persistenceOrigin !== null && origin === this.persistenceOrigin) {
      return;
    }

    this.channel.postMessage({
      type: "update",
      update,
    } satisfies SyncUpdateMessage);
  };

  private readonly onChannelMessage = (
    event: MessageEvent<unknown>,
  ): void => {
    if (this.destroyed) return;

    const message = parseMessage(event.data);
    if (!message) return;

    if (!this.readyResolved) {
      this.pendingMessages.push(message);
      return;
    }

    this.handleMessage(message);
  };

  private handleMessage(message: SyncMessage): void {
    switch (message.type) {
      case "SYNC_STEP_1": {
        const update = encodeStateAsUpdate(this.doc, message.stateVector);
        this.channel.postMessage({
          type: "SYNC_STEP_2",
          update,
        } satisfies SyncStep2Message);
        break;
      }
      case "SYNC_STEP_2":
      case "update":
        applyUpdate(this.doc, message.update, BROADCAST_ORIGIN);
        break;
      case "branch":
        this.activeBranch = message.branch;
        this.onBranchChange?.(message.branch);
        break;
    }
  }
}
