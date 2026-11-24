import "fake-indexeddb/auto";

import { clearDocument, storeState } from "y-indexeddb";
import { Text as YText } from "yjs";
import { describe, expect, it } from "vitest";

import { InMemoryObjectStorage } from "../src/core/cas/ObjectStore";
import {
  CHECKOUT_ORIGIN,
  WorkingTreeDoc,
} from "../src/core/crdt/WorkingTreeDoc";
import {
  BROADCAST_ORIGIN,
  TabSyncBridge,
} from "../src/core/crdt/TabSyncBridge";
import type { SyncChannel } from "../src/core/crdt/TabSyncBridge";
import { Repository } from "../src/core/vcs/Repository";

// ---------------------------------------------------------------------------
// Deterministic in-process BroadcastChannel stand-in
// ---------------------------------------------------------------------------

class MemoryChannelHub {
  private readonly channels = new Set<MemoryChannel>();

  create(): MemoryChannel {
    return new MemoryChannel(this);
  }

  register(channel: MemoryChannel): void {
    this.channels.add(channel);
  }

  unregister(channel: MemoryChannel): void {
    this.channels.delete(channel);
  }

  deliver(sender: MemoryChannel, data: unknown): void {
    for (const channel of [...this.channels]) {
      if (channel !== sender) channel.deliver(data);
    }
  }
}

class MemoryChannel implements SyncChannel {
  readonly sent: unknown[] = [];
  private readonly listeners = new Set<
    (event: MessageEvent<unknown>) => void
  >();
  private closed = false;

  constructor(private readonly hub: MemoryChannelHub) {
    this.hub.register(this);
  }

  postMessage(message: unknown): void {
    if (this.closed) return;

    const copy = structuredClone(message);
    this.sent.push(copy);
    this.hub.deliver(this, copy);
  }

  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    if (type === "message") this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.hub.unregister(this);
  }

  deliver(data: unknown): void {
    if (this.closed) return;
    for (const listener of [...this.listeners]) {
      listener({ data } as MessageEvent<unknown>);
    }
  }
}

function updateMessages(channel: MemoryChannel): unknown[] {
  return channel.sent.filter(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as { type?: unknown }).type === "update",
  );
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for cross-tab convergence");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function createRepository(workingTree: WorkingTreeDoc): Repository {
  let tick = 0;
  return new Repository({
    storage: new InMemoryObjectStorage(),
    workingTree,
    author: "CRDT Test",
    now: () => 1_700_000_000_000 + tick++,
  });
}

// ---------------------------------------------------------------------------
// WorkingTreeDoc
// ---------------------------------------------------------------------------

describe("WorkingTreeDoc", () => {
  it("hydrates the whole tree in one checkout transaction", async () => {
    const tree = new WorkingTreeDoc({ persist: false });
    tree.hydrateFromTree({ "alpha.md": "alpha\n", "beta.md": "beta\n" });
    expect(tree.readFiles()).toEqual({
      "alpha.md": "alpha\n",
      "beta.md": "beta\n",
    });

    const origins: unknown[] = [];
    const listener = (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    };
    tree.doc.on("update", listener);

    tree.hydrateFromTree({ "alpha.md": "ALPHA\n", "gamma.md": "gamma\n" });

    expect(origins).toEqual([CHECKOUT_ORIGIN]);
    expect(tree.readFiles()).toEqual({
      "alpha.md": "ALPHA\n",
      "gamma.md": "gamma\n",
    });

    origins.length = 0;
    tree.hydrateFromTree({ "alpha.md": "ALPHA\n", "gamma.md": "gamma\n" });
    expect(origins).toEqual([]);

    tree.doc.off("update", listener);
    await tree.destroy();
  });

  it("preserves Y.Text identity for unchanged files across hydration", async () => {
    const tree = new WorkingTreeDoc({ persist: false });
    tree.hydrateFromTree({ "keep.md": "keep\n", "edit.md": "old\n" });

    const kept = tree.getText("keep.md");
    const edited = tree.getText("edit.md");

    tree.hydrateFromTree({ "keep.md": "keep\n", "edit.md": "new\n" });

    expect(tree.getText("keep.md")).toBe(kept);
    expect(tree.getText("edit.md")).toBe(edited);
    expect(edited?.toString()).toBe("new\n");

    await tree.destroy();
  });
});

// ---------------------------------------------------------------------------
// TabSyncBridge
// ---------------------------------------------------------------------------

describe("TabSyncBridge", () => {
  it("relays local edits and never re-broadcasts received updates", async () => {
    const hub = new MemoryChannelHub();
    const docA = new WorkingTreeDoc({ persist: false });
    const docB = new WorkingTreeDoc({ persist: false });
    const channelA = hub.create();
    const channelB = hub.create();
    const bridgeA = new TabSyncBridge(docA.doc, { channel: channelA });
    const bridgeB = new TabSyncBridge(docB.doc, { channel: channelB });

    channelA.sent.length = 0;
    channelB.sent.length = 0;

    docA.setFile("doc.md", "hello from A\n");

    expect(docB.readFiles()).toEqual({ "doc.md": "hello from A\n" });
    expect(updateMessages(channelA)).toHaveLength(1);
    expect(updateMessages(channelB)).toHaveLength(0);

    docB.setFile("doc.md", "hello from B\n");

    expect(docA.readFiles()).toEqual({ "doc.md": "hello from B\n" });
    expect(updateMessages(channelB)).toHaveLength(1);
    expect(updateMessages(channelA)).toHaveLength(1);

    bridgeA.stop();
    bridgeB.stop();
    await docA.destroy();
    await docB.destroy();
  });

  it("applies remote updates with the broadcast origin", async () => {
    const hub = new MemoryChannelHub();
    const docA = new WorkingTreeDoc({ persist: false });
    const docB = new WorkingTreeDoc({ persist: false });
    const bridgeA = new TabSyncBridge(docA.doc, {
      channel: hub.create(),
    });
    const bridgeB = new TabSyncBridge(docB.doc, {
      channel: hub.create(),
    });

    const origins: unknown[] = [];
    const listener = (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    };
    docB.doc.on("update", listener);

    docA.setFile("remote.md", "from A\n");

    expect(origins).toEqual([BROADCAST_ORIGIN]);
    expect(docB.readFiles()).toEqual({ "remote.md": "from A\n" });

    docB.doc.off("update", listener);
    bridgeA.stop();
    bridgeB.stop();
    await docA.destroy();
    await docB.destroy();
  });

  it("syncs a tab opened mid-session through the state-vector handshake", async () => {
    const hub = new MemoryChannelHub();
    const docA = new WorkingTreeDoc({ persist: false });
    const bridgeA = new TabSyncBridge(docA.doc, { channel: hub.create() });

    // Uncommitted edits made before the second tab exists.
    docA.setFile("draft.md", "uncommitted draft\n");
    docA.setFile("second.md", "second file\n");

    const docB = new WorkingTreeDoc({ persist: false });
    const bridgeB = new TabSyncBridge(docB.doc, { channel: hub.create() });

    expect(docB.readFiles()).toEqual({
      "draft.md": "uncommitted draft\n",
      "second.md": "second file\n",
    });

    bridgeA.stop();
    bridgeB.stop();
    await docA.destroy();
    await docB.destroy();
  });

  it("does not re-broadcast updates originating from persistence", async () => {
    const hub = new MemoryChannelHub();
    const tree = new WorkingTreeDoc({ persist: false });
    const channel = hub.create();
    const persistenceStub = { name: "idb-persistence" };
    const bridge = new TabSyncBridge(tree.doc, {
      channel,
      persistence: persistenceStub,
    });

    channel.sent.length = 0;

    tree.doc.transact(() => {
      tree.doc
        .getMap<YText>("files")
        .set("persisted.md", new YText("from IndexedDB\n"));
    }, persistenceStub);

    expect(channel.sent).toHaveLength(0);

    tree.setFile("local.md", "from the editor\n");
    expect(updateMessages(channel)).toHaveLength(1);

    bridge.stop();
    await tree.destroy();
  });

  it("relays active branch change notifications", async () => {
    const hub = new MemoryChannelHub();
    const docA = new WorkingTreeDoc({ persist: false });
    const docB = new WorkingTreeDoc({ persist: false });
    const received: Array<string | null> = [];

    const bridgeA = new TabSyncBridge(docA.doc, {
      channel: hub.create(),
    });
    const bridgeB = new TabSyncBridge(docB.doc, {
      channel: hub.create(),
      onBranchChange: (branch) => received.push(branch),
    });

    bridgeA.broadcastBranchChange("feat/live");
    expect(received).toEqual(["feat/live"]);
    expect(bridgeB.activeBranchName).toBe("feat/live");

    bridgeA.broadcastBranchChange("main");
    expect(received).toEqual(["feat/live", "main"]);

    bridgeA.stop();
    bridgeB.stop();
    await docA.destroy();
    await docB.destroy();
  });

  it("completes the handshake over native BroadcastChannel", async () => {
    const channelName = `chronicle-test-${crypto.randomUUID()}`;
    const docA = new WorkingTreeDoc({ persist: false });
    const docB = new WorkingTreeDoc({ persist: false });
    const bridgeA = new TabSyncBridge(docA.doc, { channelName });

    docA.setFile("live.md", "live edit\n");

    const bridgeB = new TabSyncBridge(docB.doc, { channelName });

    try {
      await waitFor(() => docB.readFiles()["live.md"] === "live edit\n");

      docB.setFile("live.md", "reply from B\n");
      await waitFor(() => docA.readFiles()["live.md"] === "reply from B\n");
    } finally {
      bridgeA.stop();
      bridgeB.stop();
      await docA.destroy();
      await docB.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// Repository integration: atomic checkout and merge hydration
// ---------------------------------------------------------------------------

describe("Repository + WorkingTreeDoc", () => {
  it("hydrates checkout in a single checkout transaction", async () => {
    const tree = new WorkingTreeDoc({ persist: false });
    const repo = createRepository(tree);

    await repo.init();
    tree.setFile("alpha.md", "alpha\n");
    tree.setFile("beta.md", "beta\n");
    await repo.commit({ message: "base" });

    await repo.createBranch("feat/live");
    await repo.checkout("feat/live");
    tree.setFile("alpha.md", "feature alpha\n");
    tree.setFile("gamma.md", "gamma\n");
    await repo.commit({ message: "feature" });

    const origins: unknown[] = [];
    const listener = (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    };
    tree.doc.on("update", listener);

    await repo.checkout("main");

    tree.doc.off("update", listener);

    expect(origins).toEqual([CHECKOUT_ORIGIN]);
    expect(tree.readFiles()).toEqual({
      "alpha.md": "alpha\n",
      "beta.md": "beta\n",
    });

    await tree.destroy();
  });

  it("hydrates a clean three-way merge in a single checkout transaction", async () => {
    const tree = new WorkingTreeDoc({ persist: false });
    const repo = createRepository(tree);

    await repo.init();
    tree.hydrateFromTree({ "doc.md": "alpha\nbeta\n" });
    await repo.commit({ message: "base" });

    await repo.createBranch("feat/merge");
    await repo.checkout("feat/merge");
    tree.setFile("doc.md", "alpha\nBETA\n");
    await repo.commit({ message: "feature" });

    await repo.checkout("main");
    tree.setFile("doc.md", "ALPHA\nbeta\n");
    await repo.commit({ message: "main" });

    const origins: unknown[] = [];
    const listener = (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    };
    tree.doc.on("update", listener);

    const outcome = await repo.merge("feat/merge");

    tree.doc.off("update", listener);

    expect(outcome.status).toBe("MERGED_CLEAN");
    expect(origins).toEqual([CHECKOUT_ORIGIN]);
    expect(tree.readFiles()).toEqual({ "doc.md": "ALPHA\nBETA\n" });

    await tree.destroy();
  });
});

// ---------------------------------------------------------------------------
// y-indexeddb persistence
// ---------------------------------------------------------------------------

describe("WorkingTreeDoc persistence", () => {
  it("restores files across document instances", async () => {
    const persistenceName = `chronicle-crdt-${crypto.randomUUID()}`;

    const first = new WorkingTreeDoc({ persistenceName });
    await first.whenSynced;
    first.setFile("persisted.md", "durable\n");
    if (first.persistence) await storeState(first.persistence);
    await first.destroy();

    const second = new WorkingTreeDoc({ persistenceName });
    await second.whenSynced;
    expect(second.readFiles()).toEqual({ "persisted.md": "durable\n" });
    await second.destroy();

    await clearDocument(persistenceName);
  });
});
