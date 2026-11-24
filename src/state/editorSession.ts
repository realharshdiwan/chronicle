import { LOCAL_EDIT_ORIGIN } from '../core/crdt/origins';
import type { StoreGet, StoreSet } from './types';

export interface EditorSessionSliceState {
  files: Record<string, string>;
  filePaths: string[];
  activeFile: string | null;
  canUndoActive: boolean;
  canRedoActive: boolean;

  setActiveFile: (path: string | null) => void;
  createFile: (path: string, content?: string) => void;
  renameFile: (oldPath: string, newPath: string) => boolean;
  deleteFile: (path: string) => void;
  undoActiveFile: () => void;
  redoActiveFile: () => void;
  simulateSampleEdit: () => void;
  exportSnapshot: () => string;
}

export function createEditorSessionSlice(set: StoreSet, get: StoreGet): EditorSessionSliceState {
  return {
    files: {},
    filePaths: [],
    activeFile: null,
    canUndoActive: false,
    canRedoActive: false,

    setActiveFile: (path) => {
      const svc = get().services;
      set({
        activeFile: path,
        canUndoActive: path && svc ? svc.undoManager.canUndo(path) : false,
        canRedoActive: path && svc ? svc.undoManager.canRedo(path) : false,
      });
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
  };
}
