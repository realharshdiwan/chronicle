import {
  DEFAULT_AUTHOR_NAME,
  DEFAULT_WORKSPACE_ID,
  getWorkspaceDBNames,
  type WorkspaceMeta,
} from '../core/workspace/WorkspaceRegistry';
import { extractShareFragment, parseAndVerifySharePayload } from '../core/share/shareLink';
import {
  deleteIndexedDBQuietly,
  disposeServices,
  getRegistry,
  hydrateWorkspaceFromDump,
  scheduleStateRefresh,
  PENDING_MERGE_META_KEY,
} from './servicesSetup';
import { bootServices, collectRefreshedState } from './lifecycleHelpers';
import type { ChronicleServices, StorageQuotaInfo, StoreGet, StoreSet } from './types';
import type { PendingMergeState, StorageTelemetry } from '../core/types';

export const EMPTY_TELEMETRY: StorageTelemetry = {
  blobCount: 0,
  treeCount: 0,
  commitCount: 0,
  logicalBytes: 0,
  deduplicatedBytes: 0,
  deduplicationRatio: 1,
  lastWriteLatencyMs: 0,
  latencyHistoryMs: [],
};

const notify = (set: StoreSet, type: 'info' | 'success' | 'error', message: string) =>
  set({ notice: { type, message } });

export interface WorkspaceLifecycleSliceState {
  initialized: boolean;
  loading: boolean;
  services: ChronicleServices | null;
  workspaces: WorkspaceMeta[];
  activeWorkspaceId: string;
  authorName: string;
  telemetry: StorageTelemetry;
  latencyHistoryMs: number[];
  quota: StorageQuotaInfo | null;
  peerCount: number;

  initWorkspace: () => Promise<void>;
  disposeWorkspace: () => void;
  setAuthorName: (name: string) => boolean;
  createWorkspace: (name: string, kind: 'blank' | 'demo') => Promise<boolean>;
  switchWorkspace: (id: string) => Promise<boolean>;
  renameWorkspace: (id: string, name: string) => boolean;
  deleteWorkspace: (id: string) => Promise<boolean>;
  refreshState: () => Promise<void>;
  resetDemo: () => Promise<void>;
}

export function createWorkspaceLifecycleSlice(set: StoreSet, get: StoreGet): WorkspaceLifecycleSliceState {
  const getCallbacks = () => ({
    recordLatency: (ms: number) => {
      const rounded = Number(ms.toFixed(2));
      set((state) => ({ latencyHistoryMs: [...state.latencyHistoryMs.slice(-19), rounded] }));
    },
    scheduleRefresh: () => scheduleStateRefresh(() => void get().refreshState()),
    onBranchSync: () => void get().refreshState(),
    onPeerSync: () => {
      const cur = get().services;
      if (cur) set({ peerCount: cur.bridge.getPeerCount() });
    },
  });

  return {
    initialized: false,
    loading: false,
    services: null,
    workspaces: [],
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    authorName: DEFAULT_AUTHOR_NAME,
    telemetry: EMPTY_TELEMETRY,
    latencyHistoryMs: [],
    quota: null,
    peerCount: 0,

    initWorkspace: async () => {
      if (get().initialized || get().loading) return;
      const registry = getRegistry();
      const meta = registry.getActiveWorkspace();
      const dbNames = getWorkspaceDBNames(meta.id);
      set({ loading: true, workspaces: registry.listWorkspaces(), activeWorkspaceId: meta.id, authorName: registry.getAuthorName() });

      try {
        const hash = typeof window !== 'undefined' ? window.location.hash : '';
        const fragment = extractShareFragment(hash);
        let sharePayload = null;
        if (fragment) {
          try {
            sharePayload = await parseAndVerifySharePayload(fragment);
          } catch {
            notify(set, 'error', 'Could not decode shared workspace link.');
          }
        }

        const cb = getCallbacks();
        const services = sharePayload
          ? await hydrateWorkspaceFromDump(meta.id, dbNames, sharePayload.objects, sharePayload.refs, sharePayload.workingTreeFiles, cb.recordLatency, cb.scheduleRefresh, cb.onBranchSync, cb.onPeerSync)
          : await bootServices(meta, registry.getAuthorName(), false, cb);

        const savedPending = await services.storage.getMeta<PendingMergeState | null>(PENDING_MERGE_META_KEY);
        set({ services, pendingMerge: savedPending ?? null, initialized: true, loading: false });
        await get().refreshState();
        const paths = get().filePaths;
        if (paths.length > 0) {
          get().setActiveFile(sharePayload?.activeFile ?? (paths.includes('README.md') ? 'README.md' : paths[0]));
        }
      } catch (err) {
        set({ loading: false });
        notify(set, 'error', err instanceof Error ? err.message : 'Failed to initialize Chronicle workspace.');
      }
    },

    disposeWorkspace: () => {
      disposeServices(get().services);
      set({ services: null, initialized: false });
    },

    setAuthorName: (name) => {
      try {
        const saved = getRegistry().setAuthorName(name);
        set({ authorName: saved });
        notify(set, 'success', `Commit author updated to "${saved}".`);
        return true;
      } catch (err) {
        notify(set, 'error', err instanceof Error ? err.message : 'Invalid author name.');
        return false;
      }
    },

    createWorkspace: async (name, kind) => {
      const registry = getRegistry();
      let created: WorkspaceMeta;
      try {
        created = registry.createWorkspace(name, kind);
      } catch (err) {
        notify(set, 'error', err instanceof Error ? err.message : 'Could not create workspace.');
        return false;
      }

      disposeServices(get().services);
      set({ loading: true, services: null, workspaces: registry.listWorkspaces(), activeWorkspaceId: created.id, workspaceModalOpen: false, viewMode: 'editor' });

      try {
        const services = await bootServices(created, registry.getAuthorName(), true, getCallbacks());
        set({ services, pendingMerge: null, activeFile: null, loading: false });
        notify(set, 'success', `Created and opened workspace "${created.name}".`);
        await get().refreshState();
        return true;
      } catch (err) {
        set({ loading: false });
        notify(set, 'error', err instanceof Error ? err.message : 'Failed to create workspace.');
        return false;
      }
    },

    switchWorkspace: async (id) => {
      const registry = getRegistry();
      if (id === get().activeWorkspaceId && get().services) {
        set({ workspaceModalOpen: false });
        return true;
      }
      let meta: WorkspaceMeta;
      try {
        meta = registry.setActiveWorkspace(id);
      } catch (err) {
        notify(set, 'error', err instanceof Error ? err.message : 'Workspace not found.');
        return false;
      }

      disposeServices(get().services);
      set({ loading: true, services: null, workspaces: registry.listWorkspaces(), activeWorkspaceId: meta.id, workspaceModalOpen: false, activeFile: null, viewMode: 'editor' });

      try {
        const services = await bootServices(meta, registry.getAuthorName(), false, getCallbacks());
        const savedPending = await services.storage.getMeta<PendingMergeState | null>(PENDING_MERGE_META_KEY);
        set({ services, pendingMerge: savedPending ?? null, loading: false });
        notify(set, 'info', `Switched to workspace "${meta.name}".`);
        await get().refreshState();
        return true;
      } catch (err) {
        set({ loading: false });
        notify(set, 'error', err instanceof Error ? err.message : 'Failed to switch workspace.');
        return false;
      }
    },

    renameWorkspace: (id, name) => {
      try {
        const updated = getRegistry().renameWorkspace(id, name);
        set({ workspaces: getRegistry().listWorkspaces() });
        notify(set, 'success', `Renamed workspace to "${updated.name}".`);
        return true;
      } catch (err) {
        notify(set, 'error', err instanceof Error ? err.message : 'Rename failed.');
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
        notify(set, 'error', err instanceof Error ? err.message : 'Cannot delete workspace.');
        return false;
      }

      if (wasActive) disposeServices(get().services);
      const dbNames = getWorkspaceDBNames(id);
      await Promise.all([
        deleteIndexedDBQuietly(dbNames.casDbName),
        deleteIndexedDBQuietly(dbNames.searchDbName),
        deleteIndexedDBQuietly(dbNames.crdtDocName),
      ]);

      set({ workspaces: registry.listWorkspaces() });
      if (wasActive) await get().switchWorkspace(res.nextActiveId);
      notify(set, 'info', `Deleted workspace "${res.deleted.name}".`);
      return true;
    },

    refreshState: async () => {
      const { services, pendingMerge, activeFile, latencyHistoryMs } = get();
      if (!services || !(await services.repo.isInitialized())) return;
      const stateUpdate = await collectRefreshedState(services, pendingMerge, activeFile, latencyHistoryMs);
      set(stateUpdate);
      void services.searchEngine.syncIndex().then((searchStats) => {
        if (get().services === services) set({ searchStats });
      }).catch(() => undefined);
    },

    resetDemo: async () => {
      const prevServices = get().services;
      set({ loading: true, services: null });
      try {
        disposeServices(prevServices);
        const meta = getRegistry().getActiveWorkspace();
        const services = await bootServices(meta, getRegistry().getAuthorName(), true, getCallbacks());
        set({ services, pendingMerge: null, selectedCommitHash: null, selectedCommitDiffs: [], viewMode: 'editor', loading: false });
        notify(set, 'success', meta.kind === 'demo' ? 'Workspace reset to initial 5-commit demo repository.' : `Reset "${meta.name}" to clean initial commit.`);
        await get().refreshState();
        const paths = get().filePaths;
        if (paths.length > 0) {
          get().setActiveFile(paths.includes('README.md') ? 'README.md' : paths[0]);
        }
      } catch (err) {
        set({ loading: false });
        notify(set, 'error', err instanceof Error ? err.message : 'Reset failed.');
      }
    },
  };
}
