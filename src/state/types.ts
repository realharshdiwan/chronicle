import type {
  CommitObject,
  FileDiff,
  MergeOutcome,
  PendingMergeState,
  RefState,
  StorageTelemetry,
  WorkingTreeStatus,
} from '../core/types';
import type { IObjectStorage } from '../core/cas/ObjectStore';
import type {
  ISearchIndexStorage,
  RepositorySearchEngine,
  SearchIndexStats,
  SearchOccurrence,
  SearchResult,
} from '../core/search/SearchIndex';
import type { WorkingTreeDoc } from '../core/crdt/WorkingTreeDoc';
import type { FileUndoManager } from '../core/crdt/undo';
import type { TabSyncBridge } from '../core/crdt/TabSyncBridge';
import type { Repository } from '../core/vcs/Repository';
import type {
  WorkspaceDBNames,
  WorkspaceMeta,
} from '../core/workspace/WorkspaceRegistry';
import type { ChronicleArchiveV1 } from '../core/archive/repoArchive';
import type { GeneratedShareBundle, SharePayloadV1 } from '../core/share/shareLink';

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

export interface WorkspaceState {
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

import type { StateCreator } from 'zustand';

export type StoreSet = Parameters<StateCreator<WorkspaceState>>[0];
export type StoreGet = Parameters<StateCreator<WorkspaceState>>[1];
