import * as Y from 'yjs';
import type { ISyncTransport } from '../types';
import { BROADCAST_ORIGIN, PERSISTENCE_ORIGIN } from './origins';

export type SyncMessage =
  | { type: 'SYNC_STEP_1'; senderId: string; stateVector: number[] }
  | { type: 'SYNC_STEP_2'; senderId: string; update: number[] }
  | { type: 'UPDATE'; senderId: string; update: number[] }
  | { type: 'BRANCH_CHANGE'; senderId: string; branch: string; commitHash: string };

export class BroadcastChannelTransport implements ISyncTransport {
  private channel: BroadcastChannel;

  constructor(channelName = 'chronicle-crdt-sync') {
    this.channel = new BroadcastChannel(channelName);
  }

  send(message: unknown): void {
    this.channel.postMessage(message);
  }

  subscribe(handler: (message: unknown) => void): () => void {
    const listener = (event: MessageEvent) => {
      handler(event.data);
    };
    this.channel.addEventListener('message', listener);
    return () => {
      this.channel.removeEventListener('message', listener);
    };
  }

  close(): void {
    this.channel.close();
  }
}

export interface TabSyncBridgeOptions {
  transport?: ISyncTransport;
  channelName?: string;
  onBranchChange?: (branch: string, commitHash: string) => void;
  onPeerSync?: (peerId: string) => void;
}

export class TabSyncBridge {
  readonly tabId: string;
  private doc: Y.Doc;
  private transport: ISyncTransport | null = null;
  private unsubTransport: (() => void) | null = null;
  private onBranchChange?: (branch: string, commitHash: string) => void;
  private onPeerSync?: (peerId: string) => void;
  private peers = new Set<string>();

  constructor(doc: Y.Doc, options: TabSyncBridgeOptions = {}) {
    this.doc = doc;
    this.tabId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tab-${Math.random().toString(36).slice(2, 10)}`;
    this.onBranchChange = options.onBranchChange;
    this.onPeerSync = options.onPeerSync;

    if (options.transport) {
      this.transport = options.transport;
    } else if (typeof BroadcastChannel !== 'undefined') {
      this.transport = new BroadcastChannelTransport(
        options.channelName ?? 'chronicle-crdt-sync'
      );
    }

    if (this.transport) {
      this.unsubTransport = this.transport.subscribe((raw) =>
        this.handleMessage(raw as SyncMessage)
      );
      this.doc.on('update', this.handleLocalDocUpdate);
      this.initiateHandshake();
    }
  }

  getPeerCount(): number {
    return this.peers.size;
  }

  initiateHandshake(): void {
    if (!this.transport) return;
    const sv = Y.encodeStateVector(this.doc);
    this.transport.send({
      type: 'SYNC_STEP_1',
      senderId: this.tabId,
      stateVector: Array.from(sv),
    } satisfies SyncMessage);
  }

  broadcastBranchChange(branch: string, commitHash: string): void {
    if (!this.transport) return;
    this.transport.send({
      type: 'BRANCH_CHANGE',
      senderId: this.tabId,
      branch,
      commitHash,
    } satisfies SyncMessage);
  }

  private handleLocalDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // Origin guards: never re-broadcast remote updates or IndexedDB hydration
    if (
      origin === BROADCAST_ORIGIN ||
      origin === PERSISTENCE_ORIGIN ||
      origin === this
    ) {
      return;
    }
    this.transport?.send({
      type: 'UPDATE',
      senderId: this.tabId,
      update: Array.from(update),
    } satisfies SyncMessage);
  };

  private handleMessage(msg: SyncMessage): void {
    if (!msg || typeof msg !== 'object' || msg.senderId === this.tabId) {
      return;
    }

    this.peers.add(msg.senderId);
    this.onPeerSync?.(msg.senderId);

    switch (msg.type) {
      case 'SYNC_STEP_1': {
        const remoteSV = new Uint8Array(msg.stateVector);
        const diffUpdate = Y.encodeStateAsUpdate(this.doc, remoteSV);
        this.transport?.send({
          type: 'SYNC_STEP_2',
          senderId: this.tabId,
          update: Array.from(diffUpdate),
        } satisfies SyncMessage);

        // Also request missing updates from the peer
        const localSV = Y.encodeStateVector(this.doc);
        const responseUpdate = Y.encodeStateAsUpdate(this.doc, remoteSV);
        if (responseUpdate.byteLength === 0) {
          this.transport?.send({
            type: 'SYNC_STEP_2',
            senderId: this.tabId,
            update: Array.from(Y.encodeStateAsUpdate(this.doc)),
          } satisfies SyncMessage);
        }
        void localSV;
        break;
      }

      case 'SYNC_STEP_2':
      case 'UPDATE': {
        const updateBytes = new Uint8Array(msg.update);
        if (updateBytes.byteLength > 0) {
          Y.applyUpdate(this.doc, updateBytes, BROADCAST_ORIGIN);
        }
        break;
      }

      case 'BRANCH_CHANGE': {
        this.onBranchChange?.(msg.branch, msg.commitHash);
        break;
      }
    }
  }

  destroy(): void {
    this.doc.off('update', this.handleLocalDocUpdate);
    this.unsubTransport?.();
    this.transport?.close();
    this.unsubTransport = null;
    this.transport = null;
  }
}
