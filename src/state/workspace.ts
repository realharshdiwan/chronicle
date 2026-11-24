import { create } from 'zustand';
import { IndexedDBObjectStorage, type IObjectStorage } from '../core/cas/ObjectStore';
import { computeStorageTelemetry } from '../core/cas/telemetry';
import { LOCAL_EDIT_ORIGIN } from '../core/crdt/origins';
import { TabSyncBridge } from '../core/crdt/TabSyncBridge';
import { FileUndoManager } from '../core/crdt/undo';
import { WorkingTreeDoc } from '../core/crdt/WorkingTreeDoc';
import {
  buildRepoArchive,
  buildRepoZipBytes,
  serializeRepoArchiveJSON,
  type ChronicleArchiveV1,
} from '../core/archive/repoArchive';
import { seedBlankWorkspace, seedDemoRepo } from '../core/seed/seedDemoRepo';
import {
  DEFAULT_AUTHOR_NAME,
  DEFAULT_WORKSPACE_ID,
  getWorkspaceDBNames,
  WorkspaceRegistry,
  type WorkspaceDBNames,
  type WorkspaceKind,
  type WorkspaceMeta,
} from '../core/workspace/WorkspaceRegistry';
import type {
  CommitObject,
  FileDiff,
  MergeOutcome,
  PendingMergeState,
  RefState,
  StorageTelemetry,
  WorkingTreeStatus,
} from '../core/types';
import { diffTrees, diffWorkingTree } from '../core/vcs/diff';
import {
  hasConflictMarkers,
  resolveConflictRegion,
} from '../core/vcs/merge/conflictParser';
import {
  extractShareFragment,
  generateShareBundle,
  parseAndVerifySharePayload,
  type GeneratedShareBundle,
  type SharePayloadV1,
} from '../core/share/shareLink';
import {
  IndexedDBSearchIndexStorage,
  RepositorySearchEngine,
  type ISearchIndexStorage,
  type SearchIndexStats,
  type SearchOccurrence,
  type SearchResult,
} from '../core/search/SearchIndex';
import { Repository, UnmergedBranchError } from '../core/vcs/Repository';

const PENDING_MERGE_META_KEY = 'chronicle_pending_merge_v1';
const SEED_META_KEY = 'chronicle_demo_seeded_v1';

export type ViewMode = 'editor' | 'diff';
export type SearchScope = 'all' | 'working-tree';

export interface ChronicleServices {
  workspaceId: string;
  dbNames: WorkspaceDBNames;
  storage: IObjectStorage;
  searchStorage: ISearchIndexStorage;
  searchEngine: RepositorySearchEngine;
  workingTree: WorkingTreeDoc;
  undoManager: FileUndoManager;
  bridge: TabSyncBridge;
  repo: Repository;
}

export interface StorageQuotaInfo {
  usageBytes: number;
  quotaBytes: number;
}

export interface WorkspaceNotice {
  type: 'info' | 'success' | 'error';
  message: string;
}

interface WorkspaceState {
  initialized: boolean;
  loading: boolean;
  services: ChronicleServices | null;
  files: Record<string, string>;
  filePaths: string[];
  activeFile: string | null;
  refs: RefState | null;
  commits: CommitObject[];
  status: WorkingTreeStatus;
  diffs: FileDiff[];
  pendingMerge: PendingMergeState | null;
  telemetry: StorageTelemetry;
  latencyHistoryMs: number[];
  quota: StorageQuotaInfo | null;
  peerCount: number;

  viewMode: ViewMode;
  xrayOpen: boolean;
  paletteOpen: boolean;
  searchOpen: boolean;
  searchQuery: string;
  searchScope: SearchScope;
  searchResults: SearchResult[];
  searchStats: SearchIndexStats;
  searchLoading: boolean;
  shareModalOpen: boolean;
  shareLoading: boolean;
  shareBundle: GeneratedShareBundle | null;
  pendingSharedImport: SharePayloadV1 | null;
  workspaceModalOpen: boolean;
  backupModalOpen: boolean;
  workspaces: WorkspaceMeta[];
  activeWorkspaceId: string;
  authorName: string;
  selectedCommitHash: string | null;
  selectedCommitDiffs: FileDiff[];
  notice: WorkspaceNotice | null;

  canUndoActive: boolean;
  canRedoActive: boolean;

  initWorkspace: () => Promise<void>;
  disposeWorkspace: () => void;
  setViewMode: (mode: ViewMode) => void;
  setActiveFile: (path: string | null) => void;
  setXRayOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setWorkspaceModalOpen: (open: boolean) => void;
  setBackupModalOpen: (open: boolean) => void;
  setAuthorName: (name: string) => boolean;
  createWorkspace: (name: string, kind: 'blank' | 'demo') => Promise<boolean>;
  switchWorkspace: (id: string) => Promise<boolean>;
  renameWorkspace: (id: string, name: string) => boolean;
  deleteWorkspace: (id: string) => Promise<boolean>;
  runSearch: (query: string, scope?: SearchScope) => Promise<void>;
  openSearchResult: (result: SearchResult, occurrence: SearchOccurrence) => Promise<void>;
  clearNotice: () => void;
  setNotice: (notice: WorkspaceNotice) => void;

  openShareModal: () => Promise<void>;
  closeShareModal: () => void;
  handleShareHash: (hash: string) => Promise<void>;
  applySharedImport: (payload: SharePayloadV1) => Promise<void>;
  dismissSharedImport: () => void;

  exportRepoArchiveJSON: () => Promise<{ filename: string; content: string } | null>;
  exportRepoArchiveZip: () => Promise<{ filename: string; bytes: Uint8Array } | null>;
  importArchivePayload: (
    archive: ChronicleArchiveV1,
    mode: 'new-workspace' | 'replace-current'
  ) => Promise<boolean>;
  importFilesIntoWorkingTree: (
    importedFiles: Record<string, string>,
    skippedCount?: number
  ) => void;

  refreshState: () => Promise<void>;
  selectCommitForInspect: (commitHash: string | null) => Promise<void>;
  openCommitInXRay: (commitHash: string) => Promise<void>;
  simulateSampleEdit: () => void;
  exportSnapshot: () => string;

  createFile: (path: string, content?: string) => void;
  renameFile: (oldPath: string, newPath: string) => boolean;
  deleteFile: (path: string) => void;
  undoActiveFile: () => void;
  redoActiveFile: () => void;

  commitChanges: (message: string) => Promise<boolean>;
  createBranch: (name: string) => Promise<boolean>;
  deleteBranch: (name: string, force?: boolean) => Promise<'deleted' | 'unmerged' | 'error'>;
  checkoutTarget: (branchOrHash: string) => Promise<boolean>;
  mergeBranch: (targetBranch: string) => Promise<MergeOutcome | null>;
  resolveConflict: (
    path: string,
    regionIndex: number,
    choice: 'ours' | 'theirs' | 'both'
  ) => void;
  completeMerge: (message?: string) => Promise<boolean>;
  abortMerge: () => Promise<void>;
  resetDemo: () => Promise<void>;
}

const EMPTY_STATUS: WorkingTreeStatus = {
  clean: true,
  modified: [],
  added: [],
  deleted: [],
  conflicted: [],
  changes: {},
};

const EMPTY_TELEMETRY: StorageTelemetry = {
  blobCount: 0,
  treeCount: 0,
  commitCount: 0,
  logicalBytes: 0,
  deduplicatedBytes: 0,
  deduplicationRatio: 1,
  lastWriteLatencyMs: 0,
  latencyHistoryMs: [],
};

let unsubFilesChange: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let registryInstance: WorkspaceRegistry | null = null;

function getRegistry(): WorkspaceRegistry {
  if (!registryInstance) {
    registryInstance = new WorkspaceRegistry();
  }
  return registryInstance;
}

function deleteIndexedDBQuietly(dbName: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function readStorageQuota(): Promise<StorageQuotaInfo | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null;
  }
  try {
    const est = await navigator.storage.estimate();
    return {
      usageBytes: est.usage ?? 0,
      quotaBytes: est.quota ?? 0,
    };
  } catch {
    return null;
  }
}

async function createServices(
  options: {
    workspaceMeta: WorkspaceMeta;
    authorName: string;
    forceSeed?: boolean;
  },
  onLatency: (ms: number) => void,
  onRemoteFilesChange: () => void,
  onBranchSync: () => void,
  onPeerSync: () => void
): Promise<ChronicleServices> {
  const dbNames = getWorkspaceDBNames(options.workspaceMeta.id);
  const storage = new IndexedDBObjectStorage(dbNames.casDbName);
  if (options.forceSeed) {
    await deleteIndexedDBQuietly(dbNames.crdtDocName);
  }
  const workingTree = new WorkingTreeDoc({ docName: dbNames.crdtDocName });
  await workingTree.whenSynced;

  return finishServicesSetup(
    options.workspaceMeta,
    options.authorName,
    dbNames,
    storage,
    workingTree,
    Boolean(options.forceSeed),
    onLatency,
    onRemoteFilesChange,
    onBranchSync,
    onPeerSync
  );
}

async function finishServicesSetup(
  workspaceMeta: WorkspaceMeta,
  authorName: string,
  dbNames: WorkspaceDBNames,
  storage: IObjectStorage,
  workingTree: WorkingTreeDoc,
  forceSeed: boolean,
  onLatency: (ms: number) => void,
  onRemoteFilesChange: () => void,
  onBranchSync: () => void,
  onPeerSync: () => void
): Promise<ChronicleServices> {
  let didSeed = false;
  if (workspaceMeta.kind === 'demo') {
    didSeed = await seedDemoRepo(storage, { force: forceSeed });
  } else {
    if (forceSeed) {
      await storage.clear();
    }
    didSeed = await seedBlankWorkspace(storage, workspaceMeta.name, authorName);
  }

  const repo = new Repository(storage, onLatency);
  const searchStorage = new IndexedDBSearchIndexStorage(dbNames.searchDbName);
  if (forceSeed) {
    await searchStorage.clear();
  }
  const searchEngine = new RepositorySearchEngine(storage, searchStorage);

  if (didSeed || workingTree.listFiles().length === 0) {
    const headFiles = await repo.getHeadFiles();
    workingTree.hydrateFromTree(headFiles);
  }

  const undoManager = new FileUndoManager(workingTree.doc, workingTree.filesMap);
  const bridge = new TabSyncBridge(workingTree.doc, {
    channelName: dbNames.broadcastChannelName,
    onBranchChange: () => onBranchSync(),
    onPeerSync: () => onPeerSync(),
  });

  unsubFilesChange = workingTree.onFilesChange(() => {
    onRemoteFilesChange();
  });

  return {
    workspaceId: workspaceMeta.id,
    dbNames,
    storage,
    searchStorage,
    searchEngine,
    workingTree,
    undoManager,
    bridge,
    repo,
  };
}

function disposeServices(services: ChronicleServices | null): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  unsubFilesChange?.();
  unsubFilesChange = null;
  if (!services) return;
  services.bridge.destroy();
  services.undoManager.destroy();
  services.workingTree.destroy();
  services.searchStorage.close();
  services.storage.close();
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  initialized: false,
  loading: false,
  services: null,
  files: {},
  filePaths: [],
  activeFile: null,
  refs: null,
  commits: [],
  status: EMPTY_STATUS,
  diffs: [],
  pendingMerge: null,
  telemetry: EMPTY_TELEMETRY,
  latencyHistoryMs: [],
  quota: null,
  peerCount: 0,

  viewMode: 'editor',
  xrayOpen: false,
  paletteOpen: false,
  searchOpen: false,
  searchQuery: '',
  searchScope: 'all',
  searchResults: [],
  searchStats: { indexedBlobCount: 0, tokenCount: 0 },
  searchLoading: false,
  shareModalOpen: false,
  shareLoading: false,
  shareBundle: null,
  pendingSharedImport: null,
  workspaceModalOpen: false,
  backupModalOpen: false,
  workspaces: [],
  activeWorkspaceId: DEFAULT_WORKSPACE_ID,
  authorName: DEFAULT_AUTHOR_NAME,
  selectedCommitHash: null,
  selectedCommitDiffs: [],
  notice: null,

  canUndoActive: false,
  canRedoActive: false,

  initWorkspace: async () => {
    if (get().initialized || get().loading) return;
    const registry = getRegistry();
    const activeMeta = registry.getActiveWorkspace();
    const dbNames = getWorkspaceDBNames(activeMeta.id);

    set({
      loading: true,
      workspaces: registry.listWorkspaces(),
      activeWorkspaceId: activeMeta.id,
      authorName: registry.getAuthorName(),
    });

    try {
      const incomingFragment =
        typeof window !== 'undefined'
          ? extractShareFragment(window.location.hash)
          : null;
      let parsedIncoming: SharePayloadV1 | null = null;
      let incomingError: string | null = null;

      if (incomingFragment) {
        try {
          parsedIncoming = await parseAndVerifySharePayload(incomingFragment);
        } catch (err) {
          incomingError =
            err instanceof Error
              ? err.message
              : 'Could not decode shared workspace link.';
        }
      }

      const recordLatency = (ms: number) => {
        const rounded = Number(ms.toFixed(2));
        set((state) => ({
          latencyHistoryMs: [...state.latencyHistoryMs.slice(-19), rounded],
        }));
      };

      const scheduleRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void get().refreshState();
        }, 16);
      };

      // If fresh origin (no existing repo) and valid incoming share link, import immediately
      if (parsedIncoming) {
        const probeStorage = new IndexedDBObjectStorage(dbNames.casDbName);
        const existingRefs = await probeStorage.getRefs();
        if (!existingRefs) {
          await probeStorage.clear();
          await probeStorage.writeBatch(parsedIncoming.objects, parsedIncoming.refs);
          await probeStorage.setMeta(SEED_META_KEY, true);
          probeStorage.close();

          const workingTree = new WorkingTreeDoc({ docName: dbNames.crdtDocName });
          await workingTree.whenSynced;
          await workingTree.clearDocument();
          const freshTree = new WorkingTreeDoc({ docName: dbNames.crdtDocName });
          await freshTree.whenSynced;
          freshTree.hydrateFromTree(parsedIncoming.workingTreeFiles);

          const shareStorage = new IndexedDBObjectStorage(dbNames.casDbName);
          const shareSearchStorage = new IndexedDBSearchIndexStorage(dbNames.searchDbName);
          await shareSearchStorage.clear();
          const shareSearchEngine = new RepositorySearchEngine(
            shareStorage,
            shareSearchStorage
          );
          const repo = new Repository(shareStorage, recordLatency);
          const undoManager = new FileUndoManager(freshTree.doc, freshTree.filesMap);
          const bridge = new TabSyncBridge(freshTree.doc, {
            channelName: dbNames.broadcastChannelName,
            onBranchChange: () => void get().refreshState(),
            onPeerSync: () => {
              const current = get().services;
              if (current) set({ peerCount: current.bridge.getPeerCount() });
            },
          });
          unsubFilesChange = freshTree.onFilesChange(() => scheduleRefresh());

          const services: ChronicleServices = {
            workspaceId: activeMeta.id,
            dbNames,
            storage: shareStorage,
            searchStorage: shareSearchStorage,
            searchEngine: shareSearchEngine,
            workingTree: freshTree,
            undoManager,
            bridge,
            repo,
          };

          if (typeof window !== 'undefined') {
            window.history.replaceState(
              null,
              '',
              window.location.pathname + window.location.search
            );
          }

          set({
            services,
            pendingMerge: null,
            activeFile: parsedIncoming.activeFile,
            initialized: true,
            loading: false,
            notice: {
              type: 'success',
              message: 'Loaded shared Chronicle workspace from link.',
            },
          });
          await get().refreshState();
          return;
        }
        probeStorage.close();
      }

      const services = await createServices(
        {
          workspaceMeta: activeMeta,
          authorName: registry.getAuthorName(),
          forceSeed: false,
        },
        recordLatency,
        scheduleRefresh,
        () => {
          void get().refreshState();
        },
        () => {
          const current = get().services;
          if (current) {
            set({ peerCount: current.bridge.getPeerCount() });
          }
        }
      );

      const savedPending = await services.storage.getMeta<PendingMergeState | null>(
        PENDING_MERGE_META_KEY
      );

      set({
        services,
        pendingMerge: savedPending ?? null,
        pendingSharedImport: parsedIncoming,
        initialized: true,
        loading: false,
        notice: incomingError
          ? { type: 'error', message: incomingError }
          : null,
      });

      if (incomingError && typeof window !== 'undefined') {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search
        );
      }

      await get().refreshState();

      // Default active file
      const paths = get().filePaths;
      if (paths.length > 0 && !get().activeFile) {
        const preferred = paths.includes('README.md') ? 'README.md' : paths[0];
        set({ activeFile: preferred });
        const svc = get().services;
        if (svc) {
          set({
            canUndoActive: svc.undoManager.canUndo(preferred),
            canRedoActive: svc.undoManager.canRedo(preferred),
          });
        }
      }
    } catch (err) {
      set({
        loading: false,
        notice: {
          type: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to initialize Chronicle workspace.',
        },
      });
    }
  },

  disposeWorkspace: () => {
    disposeServices(get().services);
    set({ services: null, initialized: false });
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  setActiveFile: (path) => {
    const svc = get().services;
    set({
      activeFile: path,
      canUndoActive: path && svc ? svc.undoManager.canUndo(path) : false,
      canRedoActive: path && svc ? svc.undoManager.canRedo(path) : false,
    });
  },

  setXRayOpen: (open) => {
    set({ xrayOpen: open });
    if (open) {
      void get().refreshState();
    }
  },

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  setWorkspaceModalOpen: (open) => set({ workspaceModalOpen: open }),

  setBackupModalOpen: (open) => set({ backupModalOpen: open }),

  setAuthorName: (name) => {
    try {
      const registry = getRegistry();
      const saved = registry.setAuthorName(name);
      set({
        authorName: saved,
        notice: { type: 'success', message: `Commit author updated to "${saved}".` },
      });
      return true;
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Invalid author name.',
        },
      });
      return false;
    }
  },

  createWorkspace: async (name, kind) => {
    const registry = getRegistry();
    let created: WorkspaceMeta;
    try {
      created = registry.createWorkspace(name, kind);
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Could not create workspace.',
        },
      });
      return false;
    }

    const prevServices = get().services;
    disposeServices(prevServices);
    set({
      loading: true,
      services: null,
      workspaces: registry.listWorkspaces(),
      activeWorkspaceId: created.id,
      workspaceModalOpen: false,
      selectedCommitHash: null,
      selectedCommitDiffs: [],
      searchQuery: '',
      searchResults: [],
      viewMode: 'editor',
    });

    try {
      const recordLatency = (ms: number) => {
        const rounded = Number(ms.toFixed(2));
        set((state) => ({
          latencyHistoryMs: [...state.latencyHistoryMs.slice(-19), rounded],
        }));
      };
      const scheduleRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void get().refreshState();
        }, 16);
      };

      const services = await createServices(
        {
          workspaceMeta: created,
          authorName: registry.getAuthorName(),
          forceSeed: true,
        },
        recordLatency,
        scheduleRefresh,
        () => void get().refreshState(),
        () => {
          const current = get().services;
          if (current) set({ peerCount: current.bridge.getPeerCount() });
        }
      );

      set({
        services,
        pendingMerge: null,
        activeFile: null,
        loading: false,
        notice: {
          type: 'success',
          message: `Created and opened workspace "${created.name}".`,
        },
      });
      await get().refreshState();
      return true;
    } catch (err) {
      set({
        loading: false,
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to create workspace.',
        },
      });
      return false;
    }
  },

  switchWorkspace: async (id) => {
    const registry = getRegistry();
    if (id === get().activeWorkspaceId && get().services) {
      set({ workspaceModalOpen: false });
      return true;
    }
    let targetMeta: WorkspaceMeta;
    try {
      targetMeta = registry.setActiveWorkspace(id);
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Workspace not found.',
        },
      });
      return false;
    }

    const prevServices = get().services;
    disposeServices(prevServices);
    set({
      loading: true,
      services: null,
      workspaces: registry.listWorkspaces(),
      activeWorkspaceId: targetMeta.id,
      workspaceModalOpen: false,
      selectedCommitHash: null,
      selectedCommitDiffs: [],
      searchQuery: '',
      searchResults: [],
      activeFile: null,
      viewMode: 'editor',
    });

    try {
      const recordLatency = (ms: number) => {
        const rounded = Number(ms.toFixed(2));
        set((state) => ({
          latencyHistoryMs: [...state.latencyHistoryMs.slice(-19), rounded],
        }));
      };
      const scheduleRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void get().refreshState();
        }, 16);
      };

      const services = await createServices(
        {
          workspaceMeta: targetMeta,
          authorName: registry.getAuthorName(),
          forceSeed: false,
        },
        recordLatency,
        scheduleRefresh,
        () => void get().refreshState(),
        () => {
          const current = get().services;
          if (current) set({ peerCount: current.bridge.getPeerCount() });
        }
      );

      const savedPending = await services.storage.getMeta<PendingMergeState | null>(
        PENDING_MERGE_META_KEY
      );

      set({
        services,
        pendingMerge: savedPending ?? null,
        loading: false,
        notice: {
          type: 'info',
          message: `Switched to workspace "${targetMeta.name}".`,
        },
      });
      await get().refreshState();
      return true;
    } catch (err) {
      set({
        loading: false,
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to switch workspace.',
        },
      });
      return false;
    }
  },

  renameWorkspace: (id, name) => {
    try {
      const registry = getRegistry();
      const updated = registry.renameWorkspace(id, name);
      set({
        workspaces: registry.listWorkspaces(),
        notice: { type: 'success', message: `Renamed workspace to "${updated.name}".` },
      });
      return true;
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Rename failed.',
        },
      });
      return false;
    }
  },

  deleteWorkspace: async (id) => {
    const registry = getRegistry();
    const wasActive = id === get().activeWorkspaceId;
    let res: { nextActiveId: string; deleted: WorkspaceMeta };
    try {
      res = registry.deleteWorkspace(id);
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Cannot delete workspace.',
        },
      });
      return false;
    }

    if (wasActive) {
      disposeServices(get().services);
      set({ services: null });
    }

    const dbNames = getWorkspaceDBNames(id);
    await Promise.all([
      deleteIndexedDBQuietly(dbNames.casDbName),
      deleteIndexedDBQuietly(dbNames.searchDbName),
      deleteIndexedDBQuietly(dbNames.crdtDocName),
    ]);

    set({ workspaces: registry.listWorkspaces() });

    if (wasActive) {
      await get().switchWorkspace(res.nextActiveId);
    }
    set({
      notice: {
        type: 'info',
        message: `Deleted workspace "${res.deleted.name}".`,
      },
    });
    return true;
  },

  setSearchOpen: (open) => {
    set({ searchOpen: open });
    if (open) {
      const { services, searchQuery, searchScope } = get();
      if (services) {
        void services.searchEngine.syncIndex().then((stats) => {
          set({ searchStats: stats });
          if (searchQuery.trim()) {
            void get().runSearch(searchQuery, searchScope);
          }
        });
      }
    }
  },

  runSearch: async (query, scopeOverride) => {
    const { services, refs, files, searchScope } = get();
    const scope = scopeOverride ?? searchScope;
    set({ searchQuery: query, searchScope: scope });

    if (!services) return;
    if (!query.trim()) {
      const stats = await services.searchEngine.syncIndex();
      set({ searchResults: [], searchStats: stats, searchLoading: false });
      return;
    }

    set({ searchLoading: true });
    try {
      const results = await services.searchEngine.search({
        query,
        refs,
        workingTreeFiles: files,
        scope,
      });
      const stats = await services.searchStorage.getStats();
      if (get().searchQuery === query && get().searchScope === scope) {
        set({
          searchResults: results,
          searchStats: stats,
          searchLoading: false,
        });
      }
    } catch {
      set({ searchLoading: false });
    }
  },

  openSearchResult: async (_result, occurrence) => {
    set({ searchOpen: false });
    if (occurrence.source === 'working-tree') {
      const { files } = get();
      if (files[occurrence.path] !== undefined) {
        get().setActiveFile(occurrence.path);
        set({ viewMode: 'editor' });
      }
      return;
    }
    if (occurrence.commitHash) {
      await get().openCommitInXRay(occurrence.commitHash);
    }
  },

  clearNotice: () => set({ notice: null }),

  setNotice: (notice) => set({ notice }),

  openShareModal: async () => {
    const { services, refs, files, activeFile } = get();
    if (!services || !refs) return;
    set({ shareLoading: true, shareModalOpen: true });
    try {
      const bundle = await generateShareBundle({
        storage: services.storage,
        refs,
        workingTreeFiles: files,
        activeFile,
      });
      set({ shareBundle: bundle, shareLoading: false });
    } catch (err) {
      set({
        shareModalOpen: false,
        shareLoading: false,
        notice: {
          type: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to generate shareable link.',
        },
      });
    }
  },

  closeShareModal: () => set({ shareModalOpen: false }),

  handleShareHash: async (hash) => {
    const fragment = extractShareFragment(hash);
    if (!fragment) return;
    try {
      const payload = await parseAndVerifySharePayload(fragment);
      set({ pendingSharedImport: payload });
    } catch (err) {
      if (typeof window !== 'undefined') {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search
        );
      }
      set({
        notice: {
          type: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Invalid or corrupted shared workspace link.',
        },
      });
    }
  },

  applySharedImport: async (payload) => {
    const prevServices = get().services;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    unsubFilesChange?.();
    unsubFilesChange = null;
    set({ loading: true, services: null, pendingSharedImport: null });

    try {
      if (prevServices) {
        prevServices.bridge.destroy();
        prevServices.undoManager.destroy();
        await prevServices.workingTree.clearDocument();
        prevServices.workingTree.destroy();
        await prevServices.searchStorage.clear();
        prevServices.searchStorage.close();
        await prevServices.storage.clear();
        prevServices.storage.close();
      }

      const recordLatency = (ms: number) => {
        const rounded = Number(ms.toFixed(2));
        set((state) => ({
          latencyHistoryMs: [...state.latencyHistoryMs.slice(-19), rounded],
        }));
      };

      const scheduleRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void get().refreshState();
        }, 16);
      };

      const activeMeta = getRegistry().getActiveWorkspace();
      const dbNames = getWorkspaceDBNames(activeMeta.id);

      const storage = new IndexedDBObjectStorage(dbNames.casDbName);
      await storage.clear();
      await storage.writeBatch(payload.objects, payload.refs);
      await storage.setMeta(SEED_META_KEY, true);

      const searchStorage = new IndexedDBSearchIndexStorage(dbNames.searchDbName);
      await searchStorage.clear();
      const searchEngine = new RepositorySearchEngine(storage, searchStorage);

      const workingTree = new WorkingTreeDoc({ docName: dbNames.crdtDocName });
      await workingTree.whenSynced;
      await workingTree.clearDocument();
      const freshTree = new WorkingTreeDoc({ docName: dbNames.crdtDocName });
      await freshTree.whenSynced;
      freshTree.hydrateFromTree(payload.workingTreeFiles);

      const repo = new Repository(storage, recordLatency);
      const undoManager = new FileUndoManager(freshTree.doc, freshTree.filesMap);
      const bridge = new TabSyncBridge(freshTree.doc, {
        channelName: dbNames.broadcastChannelName,
        onBranchChange: () => void get().refreshState(),
        onPeerSync: () => {
          const current = get().services;
          if (current) set({ peerCount: current.bridge.getPeerCount() });
        },
      });
      unsubFilesChange = freshTree.onFilesChange(() => scheduleRefresh());

      if (typeof window !== 'undefined') {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search
        );
      }

      set({
        services: {
          workspaceId: activeMeta.id,
          dbNames,
          storage,
          searchStorage,
          searchEngine,
          workingTree: freshTree,
          undoManager,
          bridge,
          repo,
        },
        pendingMerge: null,
        selectedCommitHash: null,
        selectedCommitDiffs: [],
        searchQuery: '',
        searchResults: [],
        activeFile: payload.activeFile,
        viewMode: 'editor',
        loading: false,
        notice: {
          type: 'success',
          message: 'Loaded shared Chronicle workspace from link.',
        },
      });

      await get().refreshState();
    } catch (err) {
      set({
        loading: false,
        notice: {
          type: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to import shared workspace.',
        },
      });
    }
  },

  dismissSharedImport: () => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
    set({ pendingSharedImport: null });
  },

  exportRepoArchiveJSON: async () => {
    const { services, refs, files, activeFile } = get();
    if (!services || !refs) return null;
    const activeMeta = getRegistry().getActiveWorkspace();
    const archive = await buildRepoArchive({
      storage: services.storage,
      refs,
      workingTreeFiles: files,
      activeFile,
      workspaceName: activeMeta.name,
    });
    const slug = activeMeta.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'chronicle';
    return {
      filename: `${slug}-archive-${new Date().toISOString().slice(0, 10)}.json`,
      content: serializeRepoArchiveJSON(archive),
    };
  },

  exportRepoArchiveZip: async () => {
    const { services, refs, files, activeFile } = get();
    if (!services || !refs) return null;
    const activeMeta = getRegistry().getActiveWorkspace();
    const archive = await buildRepoArchive({
      storage: services.storage,
      refs,
      workingTreeFiles: files,
      activeFile,
      workspaceName: activeMeta.name,
    });
    const slug = activeMeta.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'chronicle';
    return {
      filename: `${slug}-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      bytes: buildRepoZipBytes(archive),
    };
  },

  importArchivePayload: async (archive, mode) => {
    const registry = getRegistry();
    const prevServices = get().services;
    let targetMeta: WorkspaceMeta;

    if (mode === 'new-workspace') {
      targetMeta = registry.createWorkspace(archive.workspaceName, 'imported');
    } else {
      targetMeta = registry.getActiveWorkspace();
    }

    const dbNames = getWorkspaceDBNames(targetMeta.id);
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    unsubFilesChange?.();
    unsubFilesChange = null;

    set({
      loading: true,
      services: null,
      backupModalOpen: false,
      workspaces: registry.listWorkspaces(),
      activeWorkspaceId: targetMeta.id,
    });

    try {
      if (prevServices) {
        prevServices.bridge.destroy();
        prevServices.undoManager.destroy();
        if (mode === 'replace-current') {
          await prevServices.workingTree.clearDocument();
        }
        prevServices.workingTree.destroy();
        if (mode === 'replace-current') {
          await prevServices.searchStorage.clear();
          await prevServices.storage.clear();
        }
        prevServices.searchStorage.close();
        prevServices.storage.close();
      }

      const recordLatency = (ms: number) => {
        const rounded = Number(ms.toFixed(2));
        set((state) => ({
          latencyHistoryMs: [...state.latencyHistoryMs.slice(-19), rounded],
        }));
      };
      const scheduleRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void get().refreshState();
        }, 16);
      };

      const storage = new IndexedDBObjectStorage(dbNames.casDbName);
      await storage.clear();
      await storage.writeBatch(archive.objects, archive.refs);
      await storage.setMeta(SEED_META_KEY, true);

      const searchStorage = new IndexedDBSearchIndexStorage(dbNames.searchDbName);
      await searchStorage.clear();
      const searchEngine = new RepositorySearchEngine(storage, searchStorage);

      await deleteIndexedDBQuietly(dbNames.crdtDocName);
      const freshTree = new WorkingTreeDoc({ docName: dbNames.crdtDocName });
      await freshTree.whenSynced;
      freshTree.hydrateFromTree(archive.workingTreeFiles);

      const repo = new Repository(storage, recordLatency);
      const undoManager = new FileUndoManager(freshTree.doc, freshTree.filesMap);
      const bridge = new TabSyncBridge(freshTree.doc, {
        channelName: dbNames.broadcastChannelName,
        onBranchChange: () => void get().refreshState(),
        onPeerSync: () => {
          const current = get().services;
          if (current) set({ peerCount: current.bridge.getPeerCount() });
        },
      });
      unsubFilesChange = freshTree.onFilesChange(() => scheduleRefresh());

      set({
        services: {
          workspaceId: targetMeta.id,
          dbNames,
          storage,
          searchStorage,
          searchEngine,
          workingTree: freshTree,
          undoManager,
          bridge,
          repo,
        },
        pendingMerge: null,
        selectedCommitHash: null,
        selectedCommitDiffs: [],
        searchQuery: '',
        searchResults: [],
        activeFile: archive.activeFile,
        viewMode: 'editor',
        loading: false,
        notice: {
          type: 'success',
          message: `Imported "${targetMeta.name}" (${archive.objects.filter((o) => o.type === 'commit').length} commits).`,
        },
      });
      await get().refreshState();
      return true;
    } catch (err) {
      set({
        loading: false,
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Archive import failed.',
        },
      });
      return false;
    }
  },

  importFilesIntoWorkingTree: (importedFiles, skippedCount = 0) => {
    const { services } = get();
    if (!services) return;
    const entries = Object.entries(importedFiles).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    if (entries.length === 0) return;
    for (const [path, content] of entries) {
      services.workingTree.updateFileContent(path, content, LOCAL_EDIT_ORIGIN);
    }
    const firstPath = entries[0][0];
    set({
      activeFile: firstPath,
      viewMode: 'editor',
      backupModalOpen: false,
      notice: {
        type: 'success',
        message: `Imported ${entries.length} file(s) into working tree${
          skippedCount > 0 ? ` (${skippedCount} binary/ignored skipped)` : ''
        }.`,
      },
    });
    void get().refreshState();
  },

  refreshState: async () => {
    const { services, pendingMerge, activeFile, latencyHistoryMs } = get();
    if (!services) return;
    if (!(await services.repo.isInitialized())) return;

    const files = services.workingTree.getFileMap();
    const filePaths = Object.keys(files).sort();
    const refs = await services.repo.getRefs();
    const headHash = await services.repo.getHeadCommitHash();
    const [status, diffs, commits, quota] = await Promise.all([
      services.repo.status(files, pendingMerge),
      diffWorkingTree(services.storage, headHash, files),
      services.repo.getAllCommits(),
      readStorageQuota(),
    ]);

    const lastLatency =
      latencyHistoryMs.length > 0
        ? latencyHistoryMs[latencyHistoryMs.length - 1]
        : 0;
    const telemetry = await computeStorageTelemetry(
      services.storage,
      lastLatency,
      latencyHistoryMs
    );

    let nextActiveFile = activeFile;
    if (nextActiveFile && !files[nextActiveFile]) {
      nextActiveFile = filePaths[0] ?? null;
    } else if (!nextActiveFile && filePaths.length > 0) {
      nextActiveFile = filePaths.includes('README.md')
        ? 'README.md'
        : filePaths[0];
    }

    set({
      files,
      filePaths,
      activeFile: nextActiveFile,
      refs,
      commits,
      status,
      diffs,
      telemetry,
      quota,
      peerCount: services.bridge.getPeerCount(),
      canUndoActive: nextActiveFile
        ? services.undoManager.canUndo(nextActiveFile)
        : false,
      canRedoActive: nextActiveFile
        ? services.undoManager.canRedo(nextActiveFile)
        : false,
    });

    // Keep the IndexedDB inverted search index incrementally synchronized
    void services.searchEngine
      .syncIndex()
      .then((searchStats) => {
        if (get().services === services) {
          set({ searchStats });
        }
      })
      .catch(() => undefined);
  },

  selectCommitForInspect: async (commitHash) => {
    const { services } = get();
    if (!services || !commitHash) {
      set({ selectedCommitHash: null, selectedCommitDiffs: [] });
      return;
    }

    const commit = await services.repo.getCommit(commitHash);
    if (!commit) {
      set({ selectedCommitHash: null, selectedCommitDiffs: [] });
      return;
    }

    let parentTreeHash: string | null = null;
    if (commit.parentHashes.length > 0) {
      const parent = await services.repo.getCommit(commit.parentHashes[0]);
      parentTreeHash = parent?.treeHash ?? null;
    }

    const diffs = await diffTrees(
      services.storage,
      parentTreeHash,
      commit.treeHash
    );
    set({
      selectedCommitHash: commitHash,
      selectedCommitDiffs: diffs,
    });
  },

  openCommitInXRay: async (commitHash) => {
    set({ xrayOpen: true });
    await get().refreshState();
    await get().selectCommitForInspect(commitHash);
  },

  simulateSampleEdit: () => {
    const { services, files, pendingMerge } = get();
    if (!services) return;
    if (pendingMerge) {
      set({ viewMode: 'diff' });
      return;
    }
    const target = files['docs/storage-quota.md']
      ? 'docs/storage-quota.md'
      : get().filePaths[0];
    if (!target) return;
    const current = files[target] ?? '';
    const marker = '\n- **Verified Snapshot**: Tested local CAS persistence and Myers diff.\n';
    const nextContent = current.includes('**Verified Snapshot**')
      ? `${current.trimEnd()}\n- **Edit Timestamp**: ${new Date().toLocaleTimeString()}\n`
      : `${current.trimEnd()}\n${marker}`;
    services.workingTree.updateFileContent(target, nextContent, LOCAL_EDIT_ORIGIN);
    set({
      activeFile: target,
      viewMode: 'diff',
      notice: {
        type: 'info',
        message: `Edited ${target} — inspect the Myers diff or enter a commit message above.`,
      },
    });
    void get().refreshState();
  },

  exportSnapshot: () => {
    const { files, refs, commits, telemetry } = get();
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        app: 'Chronicle',
        refs,
        telemetry,
        commits,
        workingTreeFiles: files,
      },
      null,
      2
    );
  },

  createFile: (path, content = '') => {
    const { services } = get();
    if (!services) return;
    try {
      const normalized = path.trim().replace(/^\/+/, '');
      services.workingTree.createFile(normalized, content);
      set({
        activeFile: normalized,
        viewMode: 'editor',
        notice: { type: 'success', message: `Created ${normalized}` },
      });
      void get().refreshState();
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Could not create file.',
        },
      });
    }
  },

  renameFile: (oldPath, newPath) => {
    const { services, activeFile } = get();
    if (!services) return false;
    try {
      const target = newPath.trim().replace(/^\/+/, '');
      services.workingTree.renameFile(oldPath, target);
      set({
        activeFile: activeFile === oldPath ? target : activeFile,
        notice: { type: 'success', message: `Renamed ${oldPath} → ${target}` },
      });
      void get().refreshState();
      return true;
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Could not rename file.',
        },
      });
      return false;
    }
  },

  deleteFile: (path) => {
    const { services } = get();
    if (!services) return;
    services.workingTree.deleteFile(path);
    set({
      notice: { type: 'info', message: `Removed ${path} from working tree` },
    });
    void get().refreshState();
  },

  undoActiveFile: () => {
    const { services, activeFile } = get();
    if (!services || !activeFile) return;
    services.undoManager.undo(activeFile);
    void get().refreshState();
  },

  redoActiveFile: () => {
    const { services, activeFile } = get();
    if (!services || !activeFile) return;
    services.undoManager.redo(activeFile);
    void get().refreshState();
  },

  commitChanges: async (message) => {
    const { services, files, pendingMerge, status } = get();
    if (!services) return false;
    if (pendingMerge) {
      set({
        notice: {
          type: 'error',
          message:
            'Merge in progress. Resolve conflicts and click Commit Merge in Diff view.',
        },
      });
      return false;
    }
    if (status.clean) {
      set({
        notice: { type: 'info', message: 'Working tree is clean — nothing to commit.' },
      });
      return false;
    }

    try {
      const commit = await services.repo.commit(files, message, get().authorName);
      const branchLabel =
        get().refs?.head.type === 'branch'
          ? (get().refs?.head as { type: 'branch'; branch: string }).branch
          : 'HEAD';
      services.bridge.broadcastBranchChange(branchLabel, commit.hash);
      await get().refreshState();
      set({
        notice: {
          type: 'success',
          message: `Committed ${commit.hash.slice(0, 7)}: ${commit.message}`,
        },
      });
      return true;
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Commit failed.',
        },
      });
      return false;
    }
  },

  createBranch: async (name) => {
    const { services } = get();
    if (!services) return false;
    try {
      await services.repo.createBranch(name);
      await get().refreshState();
      set({
        notice: { type: 'success', message: `Created branch "${name.trim()}"` },
      });
      return true;
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Branch creation failed.',
        },
      });
      return false;
    }
  },

  deleteBranch: async (name, force = false) => {
    const { services } = get();
    if (!services) return 'error';
    try {
      await services.repo.deleteBranch(name, force);
      await get().refreshState();
      set({
        notice: {
          type: 'info',
          message: `Deleted branch "${name}"${force ? ' (forced)' : ''}.`,
        },
      });
      return 'deleted';
    } catch (err) {
      if (err instanceof UnmergedBranchError) {
        return 'unmerged';
      }
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Could not delete branch.',
        },
      });
      return 'error';
    }
  },

  checkoutTarget: async (branchOrHash) => {
    const { services, files, pendingMerge } = get();
    if (!services) return false;
    try {
      const result = await services.repo.checkout(
        branchOrHash,
        files,
        pendingMerge
      );
      services.workingTree.hydrateFromTree(result.files);
      services.bridge.broadcastBranchChange(branchOrHash, result.commitHash);
      await get().refreshState();
      set({
        notice: { type: 'info', message: `Switched to ${branchOrHash}` },
      });
      return true;
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Checkout blocked.',
        },
      });
      return false;
    }
  },

  mergeBranch: async (targetBranch) => {
    const { services, files, pendingMerge, authorName } = get();
    if (!services) return null;
    try {
      const result = await services.repo.merge(
        targetBranch,
        files,
        authorName,
        pendingMerge
      );

      if (result.outcome === 'ALREADY_UP_TO_DATE') {
        set({
          notice: {
            type: 'info',
            message: `Already up to date with "${targetBranch}".`,
          },
        });
        return result.outcome;
      }

      if (result.outcome === 'FAST_FORWARD') {
        services.workingTree.hydrateFromTree(result.files);
        await get().refreshState();
        set({
          notice: {
            type: 'success',
            message: `Fast-forwarded to "${targetBranch}".`,
          },
        });
        return result.outcome;
      }

      if (result.outcome === 'MERGED_CLEAN') {
        services.workingTree.hydrateFromTree(result.files);
        await get().refreshState();
        set({
          notice: {
            type: 'success',
            message: `Merged "${targetBranch}" cleanly (2-parent merge commit created).`,
          },
        });
        return result.outcome;
      }

      // CONFLICT
      services.workingTree.hydrateFromTree(result.files);
      const nextPending = result.pendingMerge ?? null;
      await services.storage.setMeta(PENDING_MERGE_META_KEY, nextPending);
      set({
        pendingMerge: nextPending,
        viewMode: 'diff',
        activeFile: nextPending?.conflictedFiles[0] ?? get().activeFile,
        notice: {
          type: 'error',
          message: `Merge conflict in ${nextPending?.conflictedFiles.join(', ')}. Resolve conflicts in Diff view.`,
        },
      });
      await get().refreshState();
      return result.outcome;
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Merge failed.',
        },
      });
      return null;
    }
  },

  resolveConflict: (path, regionIndex, choice) => {
    const { services, files } = get();
    if (!services) return;
    const current = files[path];
    if (current === undefined) return;
    const resolved = resolveConflictRegion(current, regionIndex, choice);
    services.workingTree.updateFileContent(path, resolved, LOCAL_EDIT_ORIGIN);
    void get().refreshState();
  },

  completeMerge: async (message) => {
    const { services, files, pendingMerge } = get();
    if (!services || !pendingMerge) return false;

    for (const [path, content] of Object.entries(files)) {
      if (hasConflictMarkers(content)) {
        set({
          notice: {
            type: 'error',
            message: `Unresolved conflict markers remain in ${path}.`,
          },
        });
        return false;
      }
    }

    try {
      const commit = await services.repo.completeMergeCommit(
        files,
        pendingMerge,
        message,
        get().authorName
      );
      await services.storage.setMeta(PENDING_MERGE_META_KEY, null);
      const branchLabel =
        get().refs?.head.type === 'branch'
          ? (get().refs?.head as { type: 'branch'; branch: string }).branch
          : 'HEAD';
      services.bridge.broadcastBranchChange(branchLabel, commit.hash);
      set({
        pendingMerge: null,
        viewMode: 'editor',
        notice: {
          type: 'success',
          message: `Merge committed (${commit.hash.slice(0, 7)})`,
        },
      });
      await get().refreshState();
      return true;
    } catch (err) {
      set({
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Merge commit failed.',
        },
      });
      return false;
    }
  },

  abortMerge: async () => {
    const { services } = get();
    if (!services) return;
    const headFiles = await services.repo.abortMerge();
    services.workingTree.hydrateFromTree(headFiles);
    await services.storage.setMeta(PENDING_MERGE_META_KEY, null);
    set({
      pendingMerge: null,
      viewMode: 'editor',
      notice: { type: 'info', message: 'Merge aborted; working tree restored to HEAD.' },
    });
    await get().refreshState();
  },

  resetDemo: async () => {
    const prevServices = get().services;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    unsubFilesChange?.();
    unsubFilesChange = null;
    set({ loading: true, services: null });

    try {
      if (prevServices) {
        prevServices.bridge.destroy();
        prevServices.undoManager.destroy();
        await prevServices.workingTree.clearDocument();
        prevServices.workingTree.destroy();
        await prevServices.searchStorage.clear();
        prevServices.searchStorage.close();
        await prevServices.storage.clear();
        prevServices.storage.close();
      }

      const recordLatency = (ms: number) => {
        const rounded = Number(ms.toFixed(2));
        set((state) => ({
          latencyHistoryMs: [...state.latencyHistoryMs.slice(-19), rounded],
        }));
      };

      const scheduleRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          void get().refreshState();
        }, 16);
      };

      const activeMeta = getRegistry().getActiveWorkspace();
      const dbNames = getWorkspaceDBNames(activeMeta.id);

      const storage = new IndexedDBObjectStorage(dbNames.casDbName);
      const workingTree = new WorkingTreeDoc({ docName: dbNames.crdtDocName });
      await workingTree.whenSynced;

      const services = await finishServicesSetup(
        activeMeta,
        getRegistry().getAuthorName(),
        dbNames,
        storage,
        workingTree,
        true,
        recordLatency,
        scheduleRefresh,
        () => void get().refreshState(),
        () => {
          const current = get().services;
          if (current) set({ peerCount: current.bridge.getPeerCount() });
        }
      );

      set({
        services,
        pendingMerge: null,
        selectedCommitHash: null,
        selectedCommitDiffs: [],
        searchQuery: '',
        searchResults: [],
        viewMode: 'editor',
        loading: false,
        notice: {
          type: 'success',
          message:
            activeMeta.kind === 'demo'
              ? 'Workspace reset to initial 5-commit demo repository.'
              : `Reset "${activeMeta.name}" to a clean initial commit.`,
        },
      });

      await get().refreshState();
      const paths = get().filePaths;
      if (paths.length > 0) {
        get().setActiveFile(paths.includes('README.md') ? 'README.md' : paths[0]);
      }
    } catch (err) {
      set({
        loading: false,
        notice: {
          type: 'error',
          message: err instanceof Error ? err.message : 'Reset failed.',
        },
      });
    }
  },
}));
