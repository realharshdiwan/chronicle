/**
 * Reactive workspace bridge.
 *
 * Owns the browser services (IndexedDB CAS, Yjs working tree, BroadcastChannel
 * relay, Repository) and exposes a small Zustand store to the UI. All mutations
 * go through the Git-semantics Repository so checkout, merge, and dirty-tree
 * protection stay identical to the core test suite.
 */

import { create } from "zustand";
import { clearDocument } from "y-indexeddb";

import { IndexedDBObjectStorage } from "../core/cas/ObjectStore";
import { computeStorageTelemetry } from "../core/cas/telemetry";
import { DEFAULT_PERSISTENCE_NAME, WorkingTreeDoc } from "../core/crdt/WorkingTreeDoc";
import { TabSyncBridge } from "../core/crdt/TabSyncBridge";
import { resolveConflictMarkers } from "../core/merge/conflictParser";
import type { ConflictResolution } from "../core/merge/conflictParser";
import { DEMO_MAIN_BRANCH, seedDemoRepo } from "../core/seed/seedDemoRepo";
import { getCommit, getCommitHistory } from "../core/vcs/dag";
import { diffTrees, loadTreeFiles } from "../core/vcs/diff";
import { Repository } from "../core/vcs/Repository";
import type { PendingMergeState } from "../core/vcs/Repository";
import type {
  CommitObject,
  MergeOutcome,
  RefState,
  Sha256Hash,
  StorageTelemetry,
  WorkingFileDiff,
} from "../core/types";

export interface StorageEstimate {
  usage: number;
  quota: number;
}

interface WorkspaceServices {
  storage: IndexedDBObjectStorage;
  workingTree: WorkingTreeDoc;
  bridge: TabSyncBridge;
  repo: Repository;
  onDocUpdate: () => void;
}

export interface WorkspaceState {
  status: "idle" | "loading" | "ready" | "error";
  busy: boolean;
  error: string | null;

  refs: RefState | null;
  branches: Record<string, Sha256Hash>;
  activeBranch: string | null;
  remoteBranch: string | null;
  log: CommitObject[];
  graphCommits: CommitObject[];

  diffs: WorkingFileDiff[];
  fileContents: Record<string, string>;
  activePath: string | null;
  commitMessage: string;

  pendingMerge: PendingMergeState | null;
  mergeOutcome: MergeOutcome | null;

  telemetry: StorageTelemetry | null;
  latencySamples: number[];
  storageEstimate: StorageEstimate | null;

  workingTree: WorkingTreeDoc | null;
  xrayOpen: boolean;
  paletteOpen: boolean;
  inspectedCommit: CommitObject | null;
  inspectedDiffs: WorkingFileDiff[];

  initialize(): Promise<void>;
  refresh(measuredLatencyMs?: number): Promise<void>;
  selectFile(path: string | null): void;
  setCommitMessage(value: string): void;
  setPaletteOpen(open: boolean): void;
  toggleXray(): void;

  commit(): Promise<void>;
  createBranch(name: string): Promise<void>;
  checkout(branch: string): Promise<void>;
  merge(branch: string): Promise<void>;
  abortMerge(): Promise<void>;
  resolveConflict(path: string, resolution: ConflictResolution): Promise<void>;
  completeMerge(): Promise<void>;
  resetDemo(): Promise<void>;
  newFile(): Promise<void>;
  deleteFile(path: string): Promise<void>;
  inspectCommit(hash: Sha256Hash): Promise<void>;
  closeInspector(): void;
  openTwinTab(): void;
}

let services: WorkspaceServices | null = null;
let bootPromise: Promise<void> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function pickActivePath(
  files: Record<string, string>,
  current: string | null,
): string | null {
  if (current && Object.prototype.hasOwnProperty.call(files, current)) {
    return current;
  }
  return Object.keys(files).sort()[0] ?? null;
}

function appendLatency(samples: number[], latency: number): number[] {
  return [...samples, latency].slice(-24);
}

function dedupeCommits(histories: CommitObject[][]): CommitObject[] {
  const byHash = new Map<Sha256Hash, CommitObject>();
  for (const history of histories) {
    for (const commit of history) {
      if (!byHash.has(commit.hash)) byHash.set(commit.hash, commit);
    }
  }
  return [...byHash.values()].sort((left, right) => {
    if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
    return left.hash < right.hash ? -1 : left.hash > right.hash ? 1 : 0;
  });
}

function scheduleRefresh(delayMs = 90): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void useWorkspaceStore.getState().refresh();
  }, delayMs);
}

async function estimateStorage(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return null;
  }
  try {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  } catch {
    return null;
  }
}

async function disposeServices(): Promise<void> {
  if (!services) return;
  const current = services;
  services = null;
  current.bridge.stop();
  current.workingTree.doc.off("update", current.onDocUpdate);
  await current.workingTree.destroy();
  await current.storage.close();
}

async function createServices(options: { forceSeed?: boolean } = {}): Promise<WorkspaceServices> {
  const storage = new IndexedDBObjectStorage();
  const workingTree = new WorkingTreeDoc();
  await workingTree.whenSynced;

  const repo = new Repository({
    storage,
    workingTree,
    author: "Local Editor",
    defaultBranch: DEMO_MAIN_BRANCH,
  });

  const seed = await seedDemoRepo({
    storage,
    workingTree,
    force: options.forceSeed,
  });

  if (!seed.seeded && Object.keys(workingTree.readFiles()).length === 0) {
    const headHash =
      seed.refs.head.type === "branch"
        ? seed.refs.branches[seed.refs.head.name]
        : seed.refs.head.commitHash;
    if (headHash) {
      const head = await getCommit(storage, headHash);
      const files = await loadTreeFiles(storage, head.treeHash);
      workingTree.hydrateFromTree(files);
    }
  }

  const bridge = new TabSyncBridge(workingTree.doc, {
    persistence: workingTree.persistence,
    ready: workingTree.whenSynced,
    onBranchChange: (branch) => {
      useWorkspaceStore.setState({ remoteBranch: branch });
      scheduleRefresh(120);
    },
  });

  const onDocUpdate = () => scheduleRefresh();
  workingTree.doc.on("update", onDocUpdate);

  services = { storage, workingTree, bridge, repo, onDocUpdate };
  return services;
}

function requireServices(): WorkspaceServices {
  if (!services) {
    throw new Error("Workspace has not been initialized");
  }
  return services;
}

async function collectTelemetry(
  current: WorkspaceServices,
  measuredLatencyMs?: number,
  previousLatency = 0,
): Promise<{ telemetry: StorageTelemetry; estimate: StorageEstimate | null }> {
  const [objects, estimate] = await Promise.all([
    current.storage.listObjects(),
    estimateStorage(),
  ]);
  return {
    telemetry: computeStorageTelemetry(
      objects,
      measuredLatencyMs ?? previousLatency,
    ),
    estimate,
  };
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  status: "idle",
  busy: false,
  error: null,

  refs: null,
  branches: {},
  activeBranch: null,
  remoteBranch: null,
  log: [],
  graphCommits: [],

  diffs: [],
  fileContents: {},
  activePath: null,
  commitMessage: "",

  pendingMerge: null,
  mergeOutcome: null,

  telemetry: null,
  latencySamples: [],
  storageEstimate: null,

  workingTree: null,
  xrayOpen: false,
  paletteOpen: false,
  inspectedCommit: null,
  inspectedDiffs: [],

  async initialize() {
    if (get().status === "ready") return;
    if (bootPromise) return bootPromise;

    bootPromise = (async () => {
      set({ status: "loading", error: null });
      try {
        if (!services) await createServices();
        set({ workingTree: services?.workingTree ?? null });
        await get().refresh();
        set({ status: "ready" });
      } catch (error) {
        set({ status: "error", error: describeError(error) });
      } finally {
        bootPromise = null;
      }
    })();

    return bootPromise;
  },

  async refresh(measuredLatencyMs) {
    const current = services;
    if (!current) return;

    try {
      const refs = await current.repo.getRefs();
      const [log, diffs, telemetryBundle, histories] = await Promise.all([
        current.repo.log(),
        current.repo.status(),
        collectTelemetry(
          current,
          measuredLatencyMs,
          get().telemetry?.lastWriteLatencyMs ?? 0,
        ),
        Promise.all(
          Object.values(refs?.branches ?? {}).map((hash) =>
            getCommitHistory(current.storage, hash),
          ),
        ),
      ]);
      const pendingMerge = current.repo.getPendingMerge();

      const fileContents = current.workingTree.readFiles();
      const activePath = pickActivePath(fileContents, get().activePath);
      const activeBranch =
        refs?.head.type === "branch" ? refs.head.name : null;
      const latencySamples =
        measuredLatencyMs === undefined
          ? get().latencySamples
          : appendLatency(get().latencySamples, measuredLatencyMs);

      set({
        refs,
        branches: refs ? { ...refs.branches } : {},
        activeBranch,
        log,
        graphCommits: dedupeCommits(histories),
        diffs,
        fileContents,
        activePath,
        pendingMerge,
        telemetry: telemetryBundle.telemetry,
        storageEstimate: telemetryBundle.estimate,
        latencySamples,
        error: null,
      });
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  selectFile(path) {
    set({ activePath: path, inspectedCommit: null, inspectedDiffs: [] });
  },

  setCommitMessage(value) {
    set({ commitMessage: value });
  },

  setPaletteOpen(open) {
    set({ paletteOpen: open });
  },

  toggleXray() {
    set((state) => ({ xrayOpen: !state.xrayOpen }));
  },

  async commit() {
    const current = requireServices();
    const message = get().commitMessage.trim();
    if (message === "") {
      set({ error: "Write a commit message first" });
      return;
    }

    set({ busy: true, error: null });
    const start = performance.now();
    try {
      await current.repo.commit({ message });
      const latency = performance.now() - start;
      set({ commitMessage: "" });
      await get().refresh(latency);
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ busy: false });
    }
  },

  async createBranch(name) {
    const current = requireServices();
    const branch = name.trim();
    if (branch === "") return;

    set({ busy: true, error: null });
    try {
      await current.repo.createBranch(branch);
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ busy: false });
    }
  },

  async checkout(branch) {
    const current = requireServices();
    set({ busy: true, error: null });
    const start = performance.now();
    try {
      await current.repo.checkout(branch);
      const latency = performance.now() - start;
      current.bridge.broadcastBranchChange(branch);
      set({ mergeOutcome: null });
      await get().refresh(latency);
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ busy: false });
    }
  },

  async merge(branch) {
    const current = requireServices();
    set({ busy: true, error: null });
    const start = performance.now();
    try {
      const outcome = await current.repo.merge(branch);
      const latency = performance.now() - start;
      set({ mergeOutcome: outcome, error: null });
      await get().refresh(latency);
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ busy: false });
    }
  },

  async abortMerge() {
    const current = requireServices();
    set({ busy: true, error: null });
    try {
      await current.repo.abortMerge();
      set({ mergeOutcome: null });
      await get().refresh();
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ busy: false });
    }
  },

  async resolveConflict(path, resolution) {
    const current = requireServices();
    const currentContent = current.workingTree.readFiles()[path] ?? "";
    const resolved = resolveConflictMarkers(currentContent, resolution);
    current.workingTree.setFile(path, resolved, "conflict-resolution");
    await get().refresh();
  },

  async completeMerge() {
    const current = requireServices();
    set({ busy: true, error: null });
    const start = performance.now();
    try {
      await current.repo.completeMergeCommit();
      const latency = performance.now() - start;
      set({ mergeOutcome: null });
      await get().refresh(latency);
    } catch (error) {
      set({ error: describeError(error) });
    } finally {
      set({ busy: false });
    }
  },

  async resetDemo() {
    set({ busy: true, error: null });
    try {
      await disposeServices();
      await clearDocument(DEFAULT_PERSISTENCE_NAME);
      await createServices({ forceSeed: true });
      set({
        workingTree: services?.workingTree ?? null,
        activePath: null,
        mergeOutcome: null,
        inspectedCommit: null,
        inspectedDiffs: [],
        commitMessage: "",
        latencySamples: [],
      });
      await get().refresh();
      set({ status: "ready" });
    } catch (error) {
      set({ status: "error", error: describeError(error) });
    } finally {
      set({ busy: false });
    }
  },

  async newFile() {
    const current = requireServices();
    const files = current.workingTree.readFiles();
    let index = 1;
    let path = "untitled.md";
    while (Object.prototype.hasOwnProperty.call(files, path)) {
      index += 1;
      path = `untitled-${index}.md`;
    }
    current.workingTree.setFile(path, `# Untitled\n\nStart writing.\n`);
    set({ activePath: path });
    await get().refresh();
  },

  async deleteFile(path) {
    const current = requireServices();
    current.workingTree.deleteFile(path);
    if (get().activePath === path) set({ activePath: null });
    await get().refresh();
  },

  async inspectCommit(hash) {
    const current = requireServices();
    try {
      const commit = await getCommit(current.storage, hash);
      const parentHash = commit.parentHashes[0] ?? null;
      const inspectedDiffs = await diffTrees(
        current.storage,
        parentHash,
        commit.hash,
        { includeUnmodified: false },
      );
      set({ inspectedCommit: commit, inspectedDiffs, xrayOpen: true });
    } catch (error) {
      set({ error: describeError(error) });
    }
  },

  closeInspector() {
    set({ inspectedCommit: null, inspectedDiffs: [] });
  },

  openTwinTab() {
    if (typeof window === "undefined") return;
    window.open(window.location.href, "_blank", "noopener,noreferrer");
  },
}));

/** Exposed for component-level subscriptions that must not re-render the store. */
export function getWorkspaceServices(): WorkspaceServices | null {
  return services;
}
