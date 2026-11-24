import { getRegistry, disposeServices, hydrateWorkspaceFromDump } from './servicesSetup';
import {
  getWorkspaceDBNames,
  type WorkspaceMeta,
} from '../core/workspace/WorkspaceRegistry';
import {
  buildRepoArchive,
  buildRepoZipBytes,
  serializeRepoArchiveJSON,
  type ChronicleArchiveV1,
} from '../core/archive/repoArchive';
import { LOCAL_EDIT_ORIGIN } from '../core/crdt/origins';
import type { SharePayloadV1 } from '../core/share/shareLink';
import type { StoreGet, StoreSet } from './types';

export interface ArchiveSliceState {
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
  applySharedImport: (payload: SharePayloadV1) => Promise<void>;
}

export function createArchiveSlice(set: StoreSet, get: StoreGet): ArchiveSliceState {
  const getCallbacks = () => {
    const recordLatency = (ms: number) => {
      const rounded = Number(ms.toFixed(2));
      set((state) => ({
        latencyHistoryMs: [...state.latencyHistoryMs.slice(-19), rounded],
      }));
    };
    return {
      recordLatency,
      scheduleRefresh: () => void get().refreshState(),
      onBranchSync: () => void get().refreshState(),
      onPeerSync: () => {
        const cur = get().services;
        if (cur) set({ peerCount: cur.bridge.getPeerCount() });
      },
    };
  };

  return {
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
      const targetMeta: WorkspaceMeta =
        mode === 'new-workspace'
          ? registry.createWorkspace(archive.workspaceName, 'imported')
          : registry.getActiveWorkspace();

      const dbNames = getWorkspaceDBNames(targetMeta.id);

      set({
        loading: true,
        services: null,
        backupModalOpen: false,
        workspaces: registry.listWorkspaces(),
        activeWorkspaceId: targetMeta.id,
      });

      try {
        disposeServices(prevServices);
        const { recordLatency, scheduleRefresh, onBranchSync, onPeerSync } = getCallbacks();
        const services = await hydrateWorkspaceFromDump(
          targetMeta.id,
          dbNames,
          archive.objects,
          archive.refs,
          archive.workingTreeFiles,
          recordLatency,
          scheduleRefresh,
          onBranchSync,
          onPeerSync
        );

        set({
          services,
          pendingMerge: null,
          loading: false,
          activeFile: archive.activeFile ?? Object.keys(archive.workingTreeFiles)[0] ?? null,
          notice: {
            type: 'success',
            message: `Imported repository "${archive.workspaceName}" (${Object.keys(archive.objects).length} CAS objects).`,
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
      const entries = Object.entries(importedFiles);
      if (entries.length === 0) return;

      for (const [path, content] of entries) {
        services.workingTree.updateFileContent(path, content, LOCAL_EDIT_ORIGIN);
      }

      set({
        activeFile: entries[0][0],
        notice: {
          type: 'success',
          message: `Imported ${entries.length} file${entries.length === 1 ? '' : 's'} into working tree${
            skippedCount > 0 ? ` (${skippedCount} skipped)` : ''
          }.`,
        },
      });
      void get().refreshState();
    },

    applySharedImport: async (payload) => {
      const registry = getRegistry();
      const workspaceName = `Shared (${new Date().toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })})`;
      const targetMeta = registry.createWorkspace(workspaceName, 'imported');
      const dbNames = getWorkspaceDBNames(targetMeta.id);

      disposeServices(get().services);

      set({
        loading: true,
        services: null,
        pendingSharedImport: null,
        shareModalOpen: false,
        workspaces: registry.listWorkspaces(),
        activeWorkspaceId: targetMeta.id,
      });

      try {
        const { recordLatency, scheduleRefresh, onBranchSync, onPeerSync } = getCallbacks();
        const services = await hydrateWorkspaceFromDump(
          targetMeta.id,
          dbNames,
          payload.objects,
          payload.refs,
          payload.workingTreeFiles,
          recordLatency,
          scheduleRefresh,
          onBranchSync,
          onPeerSync
        );

        set({
          services,
          pendingMerge: null,
          loading: false,
          activeFile: payload.activeFile ?? Object.keys(payload.workingTreeFiles)[0] ?? null,
          notice: {
            type: 'success',
            message: `Hydrated shared workspace "${targetMeta.name}" (${Object.keys(payload.objects).length} objects).`,
          },
        });
        await get().refreshState();
      } catch (err) {
        set({
          loading: false,
          notice: {
            type: 'error',
            message: err instanceof Error ? err.message : 'Failed to hydrate share payload.',
          },
        });
      }
    },
  };
}
