import { IndexedDBObjectStorage, type IObjectStorage } from '../core/cas/ObjectStore';
import { TabSyncBridge } from '../core/crdt/TabSyncBridge';
import { FileUndoManager } from '../core/crdt/undo';
import { WorkingTreeDoc } from '../core/crdt/WorkingTreeDoc';
import { seedBlankWorkspace, seedDemoRepo } from '../core/seed/seedDemoRepo';
import {
  getWorkspaceDBNames,
  WorkspaceRegistry,
  type WorkspaceDBNames,
  type WorkspaceMeta,
} from '../core/workspace/WorkspaceRegistry';
import {
  IndexedDBSearchIndexStorage,
  RepositorySearchEngine,
} from '../core/search/SearchIndex';
import { Repository } from '../core/vcs/Repository';
import type { ChronicleServices, StorageQuotaInfo } from './types';
import type { CASObject, RefState } from '../core/types';

export const PENDING_MERGE_META_KEY = 'chronicle_pending_merge_v1';
export const SEED_META_KEY = 'chronicle_demo_seeded_v1';

let unsubFilesChange: (() => void) | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let registryInstance: WorkspaceRegistry | null = null;

export function getRegistry(): WorkspaceRegistry {
  if (!registryInstance) {
    registryInstance = new WorkspaceRegistry();
  }
  return registryInstance;
}

export function deleteIndexedDBQuietly(dbName: string): Promise<void> {
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

export async function readStorageQuota(): Promise<StorageQuotaInfo | null> {
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

export async function createServices(
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

export async function finishServicesSetup(
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

export async function hydrateWorkspaceFromDump(
  workspaceId: string,
  dbNames: WorkspaceDBNames,
  objects: CASObject[],
  refs: RefState,
  workingTreeFiles: Record<string, string>,
  onLatency: (ms: number) => void,
  onRemoteFilesChange: () => void,
  onBranchSync: () => void,
  onPeerSync: () => void
): Promise<ChronicleServices> {
  const storage = new IndexedDBObjectStorage(dbNames.casDbName);
  await storage.clear();
  await storage.writeBatch(objects, refs);
  await storage.setMeta(SEED_META_KEY, true);

  const searchStorage = new IndexedDBSearchIndexStorage(dbNames.searchDbName);
  await searchStorage.clear();
  const searchEngine = new RepositorySearchEngine(storage, searchStorage);

  await deleteIndexedDBQuietly(dbNames.crdtDocName);
  const freshTree = new WorkingTreeDoc({ docName: dbNames.crdtDocName });
  await freshTree.whenSynced;
  freshTree.hydrateFromTree(workingTreeFiles);

  const repo = new Repository(storage, onLatency);
  const undoManager = new FileUndoManager(freshTree.doc, freshTree.filesMap);
  const bridge = new TabSyncBridge(freshTree.doc, {
    channelName: dbNames.broadcastChannelName,
    onBranchChange: () => onBranchSync(),
    onPeerSync: () => onPeerSync(),
  });

  unsubFilesChange = freshTree.onFilesChange(() => {
    onRemoteFilesChange();
  });

  return {
    workspaceId,
    dbNames,
    storage,
    searchStorage,
    searchEngine,
    workingTree: freshTree,
    undoManager,
    bridge,
    repo,
  };
}

export function disposeServices(services: ChronicleServices | null): void {
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

export function setFileChangeListener(listener: () => void, tree: WorkingTreeDoc): void {
  unsubFilesChange?.();
  unsubFilesChange = tree.onFilesChange(listener);
}

export function scheduleStateRefresh(refreshFn: () => void): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshFn, 16);
}
