import type { SearchScope, StoreGet, StoreSet, WorkspaceNotice } from './types';
import {
  extractShareFragment,
  generateShareBundle,
  parseAndVerifySharePayload,
} from '../core/share/shareLink';
import type { SearchOccurrence, SearchResult } from '../core/search/SearchIndex';

export interface UiLayoutSliceState {
  viewMode: 'editor' | 'diff';
  xrayOpen: boolean;
  paletteOpen: boolean;
  searchOpen: boolean;
  searchQuery: string;
  searchScope: SearchScope;
  searchResults: SearchResult[];
  searchStats: { indexedBlobCount: number; tokenCount: number };
  searchLoading: boolean;
  shareModalOpen: boolean;
  shareLoading: boolean;
  shareBundle: import('../core/share/shareLink').GeneratedShareBundle | null;
  pendingSharedImport: import('../core/share/shareLink').SharePayloadV1 | null;
  workspaceModalOpen: boolean;
  backupModalOpen: boolean;
  notice: WorkspaceNotice | null;

  setViewMode: (mode: 'editor' | 'diff') => void;
  setXRayOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setWorkspaceModalOpen: (open: boolean) => void;
  setBackupModalOpen: (open: boolean) => void;
  setNotice: (notice: WorkspaceNotice) => void;
  clearNotice: () => void;

  openShareModal: () => Promise<void>;
  closeShareModal: () => void;
  handleShareHash: (hash: string) => Promise<void>;
  dismissSharedImport: () => void;

  runSearch: (query: string, scope?: SearchScope) => Promise<void>;
  openSearchResult: (result: SearchResult, occurrence: SearchOccurrence) => Promise<void>;
}

export function createUiLayoutSlice(set: StoreSet, get: StoreGet): UiLayoutSliceState {
  return {
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
    notice: null,

    setViewMode: (mode) => set({ viewMode: mode }),

    setXRayOpen: (open) => {
      set({ xrayOpen: open });
      if (open) {
        void get().refreshState();
      }
    },

    setPaletteOpen: (open) => set({ paletteOpen: open }),

    setWorkspaceModalOpen: (open) => set({ workspaceModalOpen: open }),

    setBackupModalOpen: (open) => set({ backupModalOpen: open }),

    setNotice: (notice) => set({ notice }),

    clearNotice: () => set({ notice: null }),

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
  };
}
