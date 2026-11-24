import type {
  CommitObject,
  FileDiff,
  MergeOutcome,
  PendingMergeState,
  RefState,
  WorkingTreeStatus,
} from '../core/types';
import { diffTrees } from '../core/vcs/diff';
import {
  hasConflictMarkers,
  resolveConflictRegion,
} from '../core/vcs/merge/conflictParser';
import { UnmergedBranchError } from '../core/vcs/Repository';
import { LOCAL_EDIT_ORIGIN } from '../core/crdt/origins';
import { PENDING_MERGE_META_KEY } from './servicesSetup';
import type { StoreGet, StoreSet } from './types';

export const EMPTY_STATUS: WorkingTreeStatus = {
  clean: true,
  modified: [],
  added: [],
  deleted: [],
  conflicted: [],
  changes: {},
};

const notify = (
  set: StoreSet,
  type: 'info' | 'success' | 'error',
  message: string
) => set({ notice: { type, message } });

export interface VcsSliceState {
  refs: RefState | null;
  commits: CommitObject[];
  status: WorkingTreeStatus;
  diffs: FileDiff[];
  pendingMerge: PendingMergeState | null;
  selectedCommitHash: string | null;
  selectedCommitDiffs: FileDiff[];

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
  selectCommitForInspect: (commitHash: string | null) => Promise<void>;
  openCommitInXRay: (commitHash: string) => Promise<void>;
}

export function createVcsSlice(set: StoreSet, get: StoreGet): VcsSliceState {
  return {
    refs: null,
    commits: [],
    status: EMPTY_STATUS,
    diffs: [],
    pendingMerge: null,
    selectedCommitHash: null,
    selectedCommitDiffs: [],

    commitChanges: async (message) => {
      const { services, files, status, pendingMerge } = get();
      if (!services) return false;
      if (pendingMerge) {
        notify(set, 'error', 'Merge in progress. Resolve conflicts and click Commit Merge in Diff view.');
        return false;
      }
      if (status.clean) {
        notify(set, 'info', 'Working tree is clean — nothing to commit.');
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
        notify(set, 'success', `Committed ${commit.hash.slice(0, 7)}: ${commit.message}`);
        return true;
      } catch (err) {
        notify(set, 'error', err instanceof Error ? err.message : 'Commit failed.');
        return false;
      }
    },

    createBranch: async (name) => {
      const { services } = get();
      if (!services) return false;
      try {
        await services.repo.createBranch(name);
        await get().refreshState();
        notify(set, 'success', `Created branch "${name.trim()}"`);
        return true;
      } catch (err) {
        notify(set, 'error', err instanceof Error ? err.message : 'Branch creation failed.');
        return false;
      }
    },

    deleteBranch: async (name, force = false) => {
      const { services } = get();
      if (!services) return 'error';
      try {
        await services.repo.deleteBranch(name, force);
        await get().refreshState();
        notify(set, 'info', `Deleted branch "${name}"${force ? ' (forced)' : ''}.`);
        return 'deleted';
      } catch (err) {
        if (err instanceof UnmergedBranchError) return 'unmerged';
        notify(set, 'error', err instanceof Error ? err.message : 'Could not delete branch.');
        return 'error';
      }
    },

    checkoutTarget: async (branchOrHash) => {
      const { services, files, pendingMerge } = get();
      if (!services) return false;
      try {
        const result = await services.repo.checkout(branchOrHash, files, pendingMerge);
        services.workingTree.hydrateFromTree(result.files);
        services.bridge.broadcastBranchChange(branchOrHash, result.commitHash);
        await get().refreshState();
        notify(set, 'info', `Switched to ${branchOrHash}`);
        return true;
      } catch (err) {
        notify(set, 'error', err instanceof Error ? err.message : 'Checkout blocked.');
        return false;
      }
    },

    mergeBranch: async (targetBranch) => {
      const { services, files, pendingMerge, authorName } = get();
      if (!services) return null;
      try {
        const result = await services.repo.merge(targetBranch, files, authorName, pendingMerge);

        if (result.outcome === 'ALREADY_UP_TO_DATE') {
          notify(set, 'info', `Already up to date with "${targetBranch}".`);
          return result.outcome;
        }

        if (result.outcome === 'FAST_FORWARD') {
          services.workingTree.hydrateFromTree(result.files);
          await get().refreshState();
          notify(set, 'success', `Fast-forwarded to "${targetBranch}".`);
          return result.outcome;
        }

        if (result.outcome === 'MERGED_CLEAN') {
          services.workingTree.hydrateFromTree(result.files);
          await get().refreshState();
          notify(set, 'success', `Merged "${targetBranch}" cleanly (2-parent merge commit created).`);
          return result.outcome;
        }

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
        notify(set, 'error', err instanceof Error ? err.message : 'Merge failed.');
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
          notify(set, 'error', `Unresolved conflict markers remain in ${path}.`);
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
        set({ pendingMerge: null, viewMode: 'editor' });
        notify(set, 'success', `Merge committed (${commit.hash.slice(0, 7)})`);
        await get().refreshState();
        return true;
      } catch (err) {
        notify(set, 'error', err instanceof Error ? err.message : 'Merge commit failed.');
        return false;
      }
    },

    abortMerge: async () => {
      const { services } = get();
      if (!services) return;
      const headFiles = await services.repo.abortMerge();
      services.workingTree.hydrateFromTree(headFiles);
      await services.storage.setMeta(PENDING_MERGE_META_KEY, null);
      set({ pendingMerge: null, viewMode: 'editor' });
      notify(set, 'info', 'Merge aborted; working tree restored to HEAD.');
      await get().refreshState();
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

      const diffs = await diffTrees(services.storage, parentTreeHash, commit.treeHash);
      set({ selectedCommitHash: commitHash, selectedCommitDiffs: diffs });
    },

    openCommitInXRay: async (commitHash) => {
      set({ xrayOpen: true });
      await get().refreshState();
      await get().selectCommitForInspect(commitHash);
    },
  };
}
