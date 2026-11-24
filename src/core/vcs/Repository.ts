import {
  createBlobObject,
  createCommitObject,
  createTreeObject,
} from '../cas/hash';
import type { IObjectStorage } from '../cas/ObjectStore';
import type {
  CASObject,
  CommitObject,
  MergeOutcome,
  PendingMergeState,
  RefState,
  WorkingTreeStatus,
} from '../types';
import { findLCA, getCommitHistory, isAncestor } from './dag';
import { diffFileMaps, loadTreeFiles } from './diff';
import { hasConflictMarkers } from './merge/conflictParser';
import { threeWayMergeFiles } from './merge/threeWayMerge';

export class DirtyWorkingTreeError extends Error {
  constructor(message = 'Working tree has uncommitted changes. Commit or reset before switching branches or merging.') {
    super(message);
    this.name = 'DirtyWorkingTreeError';
  }
}

export class UnmergedBranchError extends Error {
  constructor(branchName: string) {
    super(
      `Branch "${branchName}" contains unmerged commits. Force delete to discard the branch pointer.`
    );
    this.name = 'UnmergedBranchError';
  }
}

export class Repository {
  private storage: IObjectStorage;
  private onWriteLatency?: (latencyMs: number) => void;

  constructor(
    storage: IObjectStorage,
    onWriteLatency?: (latencyMs: number) => void
  ) {
    this.storage = storage;
    this.onWriteLatency = onWriteLatency;
  }

  async isInitialized(): Promise<boolean> {
    const refs = await this.storage.getRefs();
    return refs !== null;
  }

  async init(
    initialFiles: Record<string, string> = {},
    author = 'Chronicle Author',
    message = 'Initial commit',
    timestamp = Date.now()
  ): Promise<CommitObject> {
    const { objectsToWrite, treeHash } = await this.buildTreeObjects(initialFiles);
    const commit = await createCommitObject({
      treeHash,
      parentHashes: [],
      message,
      author,
      timestamp,
    });
    objectsToWrite.push(commit);

    const refs: RefState = {
      head: { type: 'branch', branch: 'main' },
      branches: { main: commit.hash },
    };

    const latency = await this.storage.writeBatch(objectsToWrite, refs);
    this.onWriteLatency?.(latency);
    return commit;
  }

  async getRefs(): Promise<RefState> {
    const refs = await this.storage.getRefs();
    if (!refs) {
      throw new Error('Repository is not initialized.');
    }
    return refs;
  }

  async getHeadCommitHash(): Promise<string | null> {
    const refs = await this.storage.getRefs();
    if (!refs) return null;
    if (refs.head.type === 'branch') {
      return refs.branches[refs.head.branch] ?? null;
    }
    return refs.head.commitHash;
  }

  async getCommit(hash: string): Promise<CommitObject | null> {
    const obj = await this.storage.getObject(hash);
    if (!obj || obj.type !== 'commit') return null;
    return obj;
  }

  async getCommitTreeFiles(commitHash: string | null): Promise<Record<string, string>> {
    if (!commitHash) return {};
    const commit = await this.getCommit(commitHash);
    if (!commit) return {};
    return loadTreeFiles(this.storage, commit.treeHash);
  }

  async getHeadFiles(): Promise<Record<string, string>> {
    const headHash = await this.getHeadCommitHash();
    return this.getCommitTreeFiles(headHash);
  }

  async status(
    workingFiles: Record<string, string>,
    pendingMerge?: PendingMergeState | null
  ): Promise<WorkingTreeStatus> {
    const headFiles = await this.getHeadFiles();
    const diffs = diffFileMaps(headFiles, workingFiles);

    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];
    const conflicted: string[] = [];
    const changes: WorkingTreeStatus['changes'] = {};

    for (const d of diffs) {
      if (d.status === 'modified') {
        modified.push(d.path);
        changes[d.path] = 'modified';
      } else if (d.status === 'added') {
        added.push(d.path);
        changes[d.path] = 'added';
      } else if (d.status === 'deleted') {
        deleted.push(d.path);
        changes[d.path] = 'deleted';
      }
    }

    // Check any file containing conflict markers or tracked as pending conflict
    const allPaths = Array.from(
      new Set([
        ...Object.keys(workingFiles),
        ...(pendingMerge?.conflictedFiles ?? []),
      ])
    ).sort();

    for (const path of allPaths) {
      const content = workingFiles[path];
      if (content !== undefined && hasConflictMarkers(content)) {
        conflicted.push(path);
        changes[path] = 'conflicted';
      }
    }

    return {
      clean:
        modified.length === 0 &&
        added.length === 0 &&
        deleted.length === 0 &&
        conflicted.length === 0 &&
        !pendingMerge,
      modified,
      added,
      deleted,
      conflicted,
      changes,
    };
  }

  async assertCleanWorkingTree(
    workingFiles: Record<string, string>,
    pendingMerge?: PendingMergeState | null
  ): Promise<void> {
    if (pendingMerge) {
      throw new DirtyWorkingTreeError(
        'A merge is currently in progress. Resolve conflicts and commit or abort the merge first.'
      );
    }
    const currentStatus = await this.status(workingFiles, pendingMerge);
    if (!currentStatus.clean) {
      throw new DirtyWorkingTreeError();
    }
  }

  private async buildTreeObjects(
    files: Record<string, string>
  ): Promise<{ objectsToWrite: CASObject[]; treeHash: string }> {
    const objectsToWrite: CASObject[] = [];
    const entries: Record<string, string> = {};

    const sortedPaths = Object.keys(files).sort();
    for (const path of sortedPaths) {
      const blob = await createBlobObject(files[path]);
      entries[path] = blob.hash;
      if (!(await this.storage.hasObject(blob.hash))) {
        objectsToWrite.push(blob);
      }
    }

    const tree = await createTreeObject(entries);
    if (!(await this.storage.hasObject(tree.hash))) {
      objectsToWrite.push(tree);
    }

    return { objectsToWrite, treeHash: tree.hash };
  }

  async commit(
    workingFiles: Record<string, string>,
    message: string,
    author = 'Chronicle Author',
    parentHashesOverride?: string[],
    timestamp = Date.now()
  ): Promise<CommitObject> {
    const trimmed = message.trim();
    if (!trimmed) {
      throw new Error('Commit message cannot be empty.');
    }

    for (const [path, content] of Object.entries(workingFiles)) {
      if (hasConflictMarkers(content)) {
        throw new Error(`Unresolved conflict markers remain in ${path}.`);
      }
    }

    const refs = await this.getRefs();
    const headCommitHash = await this.getHeadCommitHash();
    const parentHashes =
      parentHashesOverride ?? (headCommitHash ? [headCommitHash] : []);

    const { objectsToWrite, treeHash } = await this.buildTreeObjects(workingFiles);
    const commit = await createCommitObject({
      treeHash,
      parentHashes,
      message: trimmed,
      author,
      timestamp,
    });
    objectsToWrite.push(commit);

    const nextRefs: RefState = {
      head: { ...refs.head },
      branches: { ...refs.branches },
    };

    if (nextRefs.head.type === 'branch') {
      nextRefs.branches[nextRefs.head.branch] = commit.hash;
    } else {
      nextRefs.head = { type: 'detached', commitHash: commit.hash };
    }

    const latency = await this.storage.writeBatch(objectsToWrite, nextRefs);
    this.onWriteLatency?.(latency);
    return commit;
  }

  async createBranch(name: string, fromCommitHash?: string): Promise<RefState> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Branch name cannot be empty.');
    }
    if (/\s/.test(trimmed)) {
      throw new Error('Branch name cannot contain whitespace.');
    }

    const refs = await this.getRefs();
    if (refs.branches[trimmed]) {
      throw new Error(`Branch "${trimmed}" already exists.`);
    }

    const baseHash = fromCommitHash ?? (await this.getHeadCommitHash());
    if (!baseHash) {
      throw new Error('Cannot create branch without an existing commit.');
    }

    const nextRefs: RefState = {
      head: { ...refs.head },
      branches: {
        ...refs.branches,
        [trimmed]: baseHash,
      },
    };
    await this.storage.setRefs(nextRefs);
    return nextRefs;
  }

  async isBranchMerged(name: string): Promise<boolean> {
    const refs = await this.getRefs();
    const targetHash = refs.branches[name];
    const headHash = await this.getHeadCommitHash();
    if (!targetHash || !headHash) return false;
    if (targetHash === headHash) return true;
    return isAncestor(this.storage, targetHash, headHash);
  }

  async deleteBranch(name: string, force = false): Promise<RefState> {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Branch name cannot be empty.');
    }

    const refs = await this.getRefs();
    const targetHash = refs.branches[trimmed];
    if (!targetHash) {
      throw new Error(`Branch "${trimmed}" does not exist.`);
    }

    if (refs.head.type === 'branch' && refs.head.branch === trimmed) {
      throw new Error(
        `Cannot delete the active branch "${trimmed}". Switch to another branch first.`
      );
    }

    if (!force) {
      const merged = await this.isBranchMerged(trimmed);
      if (!merged) {
        throw new UnmergedBranchError(trimmed);
      }
    }

    const nextBranches = { ...refs.branches };
    delete nextBranches[trimmed];
    const nextRefs: RefState = {
      head: { ...refs.head },
      branches: nextBranches,
    };
    await this.storage.setRefs(nextRefs);
    return nextRefs;
  }

  async checkout(
    branchOrHash: string,
    workingFiles: Record<string, string>,
    pendingMerge?: PendingMergeState | null
  ): Promise<{ files: Record<string, string>; refs: RefState; commitHash: string }> {
    await this.assertCleanWorkingTree(workingFiles, pendingMerge);

    const refs = await this.getRefs();
    let nextRefs: RefState;
    let targetCommitHash: string;

    if (refs.branches[branchOrHash]) {
      targetCommitHash = refs.branches[branchOrHash];
      nextRefs = {
        head: { type: 'branch', branch: branchOrHash },
        branches: { ...refs.branches },
      };
    } else {
      const commit = await this.getCommit(branchOrHash);
      if (!commit) {
        throw new Error(`Unknown branch or commit "${branchOrHash}".`);
      }
      targetCommitHash = commit.hash;
      nextRefs = {
        head: { type: 'detached', commitHash: targetCommitHash },
        branches: { ...refs.branches },
      };
    }

    const files = await this.getCommitTreeFiles(targetCommitHash);
    await this.storage.setRefs(nextRefs);
    return { files, refs: nextRefs, commitHash: targetCommitHash };
  }

  async merge(
    targetBranch: string,
    workingFiles: Record<string, string>,
    author = 'Chronicle Author',
    pendingMerge?: PendingMergeState | null,
    timestamp = Date.now()
  ): Promise<{
    outcome: MergeOutcome;
    files: Record<string, string>;
    commit?: CommitObject;
    pendingMerge?: PendingMergeState;
    refs: RefState;
  }> {
    await this.assertCleanWorkingTree(workingFiles, pendingMerge);

    const refs = await this.getRefs();
    const targetHash = refs.branches[targetBranch];
    if (!targetHash) {
      throw new Error(`Branch "${targetBranch}" does not exist.`);
    }

    const headHash = await this.getHeadCommitHash();
    if (!headHash) {
      throw new Error('Cannot merge without a HEAD commit.');
    }

    // 1. Same commit or target is already an ancestor of HEAD -> already up to date
    if (
      headHash === targetHash ||
      (await isAncestor(this.storage, targetHash, headHash))
    ) {
      const files = await this.getCommitTreeFiles(headHash);
      return { outcome: 'ALREADY_UP_TO_DATE', files, refs };
    }

    // 2. HEAD is an ancestor of target -> Fast-Forward
    if (await isAncestor(this.storage, headHash, targetHash)) {
      const nextRefs: RefState = {
        head: { ...refs.head },
        branches: { ...refs.branches },
      };
      if (nextRefs.head.type === 'branch') {
        nextRefs.branches[nextRefs.head.branch] = targetHash;
      } else {
        nextRefs.head = { type: 'detached', commitHash: targetHash };
      }
      await this.storage.setRefs(nextRefs);
      const files = await this.getCommitTreeFiles(targetHash);
      return { outcome: 'FAST_FORWARD', files, refs: nextRefs };
    }

    // 3. True 3-way merge using deterministic LCA
    const lcaHash = await findLCA(this.storage, headHash, targetHash);
    const [baseFiles, oursFiles, theirsFiles] = await Promise.all([
      this.getCommitTreeFiles(lcaHash),
      this.getCommitTreeFiles(headHash),
      this.getCommitTreeFiles(targetHash),
    ]);

    const mergeResult = threeWayMergeFiles(
      baseFiles,
      oursFiles,
      theirsFiles,
      targetBranch
    );

    if (mergeResult.clean) {
      const currentName =
        refs.head.type === 'branch' ? refs.head.branch : headHash.slice(0, 7);
      const commit = await this.commit(
        mergeResult.mergedFiles,
        `Merge branch '${targetBranch}' into ${currentName}`,
        author,
        [headHash, targetHash],
        timestamp
      );
      const nextRefs = await this.getRefs();
      return {
        outcome: 'MERGED_CLEAN',
        files: mergeResult.mergedFiles,
        commit,
        refs: nextRefs,
      };
    }

    // 4. Conflict -> return merged working files containing conflict markers + pendingMerge
    return {
      outcome: 'CONFLICT',
      files: mergeResult.mergedFiles,
      pendingMerge: {
        targetBranch,
        targetCommitHash: targetHash,
        lcaCommitHash: lcaHash,
        conflictedFiles: mergeResult.conflictedFiles,
      },
      refs,
    };
  }

  async completeMergeCommit(
    workingFiles: Record<string, string>,
    pendingMerge: PendingMergeState,
    message?: string,
    author = 'Chronicle Author',
    timestamp = Date.now()
  ): Promise<CommitObject> {
    for (const [path, content] of Object.entries(workingFiles)) {
      if (hasConflictMarkers(content)) {
        throw new Error(
          `Cannot complete merge: unresolved conflict markers remain in ${path}.`
        );
      }
    }

    const refs = await this.getRefs();
    const headHash = await this.getHeadCommitHash();
    if (!headHash) {
      throw new Error('Cannot complete merge without HEAD.');
    }

    const currentName =
      refs.head.type === 'branch' ? refs.head.branch : headHash.slice(0, 7);
    const finalMessage =
      message?.trim() ||
      `Merge branch '${pendingMerge.targetBranch}' into ${currentName}`;

    return this.commit(
      workingFiles,
      finalMessage,
      author,
      [headHash, pendingMerge.targetCommitHash],
      timestamp
    );
  }

  async abortMerge(): Promise<Record<string, string>> {
    return this.getHeadFiles();
  }

  async reset(
    targetBranchOrHash: string
  ): Promise<{ files: Record<string, string>; refs: RefState }> {
    const refs = await this.getRefs();
    const targetHash = refs.branches[targetBranchOrHash] ?? targetBranchOrHash;
    const commit = await this.getCommit(targetHash);
    if (!commit) {
      throw new Error(`Cannot reset: commit "${targetBranchOrHash}" not found.`);
    }

    const nextRefs: RefState = {
      head: { ...refs.head },
      branches: { ...refs.branches },
    };

    if (nextRefs.head.type === 'branch') {
      nextRefs.branches[nextRefs.head.branch] = commit.hash;
    } else {
      nextRefs.head = { type: 'detached', commitHash: commit.hash };
    }

    await this.storage.setRefs(nextRefs);
    const files = await this.getCommitTreeFiles(commit.hash);
    return { files, refs: nextRefs };
  }

  async log(maxCount?: number): Promise<CommitObject[]> {
    const headHash = await this.getHeadCommitHash();
    if (!headHash) return [];
    return getCommitHistory(this.storage, [headHash], maxCount);
  }

  async getAllCommits(): Promise<CommitObject[]> {
    const refs = await this.storage.getRefs();
    if (!refs) return [];
    const heads = new Set<string>(Object.values(refs.branches));
    if (refs.head.type === 'detached') {
      heads.add(refs.head.commitHash);
    }
    return getCommitHistory(this.storage, Array.from(heads));
  }
}
