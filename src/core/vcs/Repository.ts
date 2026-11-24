/**
 * Git-semantics repository orchestration over the CAS object store and a live
 * working tree adapter.
 *
 * Invariant 4: checkout and merge refuse to destroy uncommitted work unless
 * explicitly forced. Invariant 5: every non-fast-forward merge computes its
 * base through dag.findLCA before invoking the three-way merge.
 */

import { hashObjectPayload, isSha256Hash, utf8ByteLength } from "../cas/hash";
import type { IObjectStorage } from "../cas/ObjectStore";
import { findConflictMarkerPaths } from "../merge/conflictParser";
import { threeWayMerge } from "../merge/threeWayMerge";
import type {
  BlobObject,
  CommitObject,
  MergeOutcome,
  RefState,
  Sha256Hash,
  StoredObject,
  TreeObject,
  WorkingFileDiff,
} from "../types";
import { findLCA, getCommit, getCommitHistory, isAncestor } from "./dag";
import { diffFileMaps, loadTreeFiles } from "./diff";
import type { DiffOptions } from "./diff";
import {
  BranchAlreadyExistsError,
  BranchNotFoundError,
  DetachedHeadError,
  DirtyWorkingTreeError,
  InvalidBranchNameError,
  InvalidWorkingTreeError,
  MergeInProgressError,
  MergeTargetMovedError,
  NoHeadError,
  NoPendingMergeError,
  NothingToCommitError,
  RevisionNotFoundError,
  UnresolvedConflictsError,
  UnrelatedHistoriesError,
  VcsError,
} from "./errors";

/**
 * The live working tree facade. Phase 3's Yjs WorkingTreeDoc implements this
 * adapter; tests can use a plain object-backed implementation.
 */
export interface IWorkingTree {
  readFiles():
    | Readonly<Record<string, string>>
    | Promise<Readonly<Record<string, string>>>;
  hydrateFromTree(
    files: Readonly<Record<string, string>>,
  ): void | Promise<void>;
}

export interface RepositoryOptions {
  storage: IObjectStorage;
  workingTree: IWorkingTree;
  author?: string;
  defaultBranch?: string;
  /** Injectable clock for deterministic commit hashes in tests. */
  now?: () => number;
}

export interface CommitOptions {
  message: string;
  author?: string;
  allowEmpty?: boolean;
}

export interface CheckoutOptions {
  force?: boolean;
}

export interface MergeOptions {
  message?: string;
  author?: string;
  force?: boolean;
}

export interface CompleteMergeOptions {
  message?: string;
  author?: string;
  /** Final file contents; defaults to the current working tree. */
  files?: Readonly<Record<string, string>>;
}

export interface ResetOptions {
  hard?: boolean;
}

export interface LogOptions {
  limit?: number;
  from?: string;
}

/** In-memory merge session; cleared by completeMergeCommit or abortMerge. */
export interface PendingMergeState {
  sourceBranch: string;
  targetBranch: string;
  baseCommitHash: Sha256Hash;
  sourceCommitHash: Sha256Hash;
  targetCommitHash: Sha256Hash;
  conflictPaths: string[];
}

const BRANCH_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function validateBranchName(name: string): void {
  if (
    name === "" ||
    name.length > 255 ||
    !BRANCH_NAME_PATTERN.test(name) ||
    name === "HEAD" ||
    name.includes("..") ||
    name.includes("//") ||
    name.endsWith("/") ||
    name.endsWith(".") ||
    name.endsWith(".lock")
  ) {
    throw new InvalidBranchNameError(name);
  }
}

function validateFilePath(path: string): void {
  if (
    path === "" ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path === "__proto__"
  ) {
    throw new InvalidWorkingTreeError(
      `Invalid file path ${JSON.stringify(path)}: paths must be relative POSIX paths`,
    );
  }

  for (const segment of path.split("/")) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      segment === "__proto__"
    ) {
      throw new InvalidWorkingTreeError(
        `Invalid file path ${JSON.stringify(path)}: path segments must name files or directories`,
      );
    }
  }
}

function normalizeFiles(
  files: Readonly<Record<string, string>>,
): Record<string, string> {
  const entries: Array<[string, string]> = [];

  for (const [path, content] of Object.entries(files)) {
    validateFilePath(path);
    if (typeof content !== "string") {
      throw new InvalidWorkingTreeError(
        `File ${JSON.stringify(path)} must have string content`,
      );
    }
    entries.push([path, content]);
  }

  entries.sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  const normalized: Record<string, string> = {};
  for (const [path, content] of entries) {
    normalized[path] = content;
  }
  return normalized;
}

function compareBranches(refs: RefState): Record<string, Sha256Hash> {
  return { ...refs.branches };
}

export class Repository {
  readonly storage: IObjectStorage;
  readonly workingTree: IWorkingTree;

  private readonly author: string;
  private readonly defaultBranch: string;
  private readonly now: () => number;
  private pendingMerge: PendingMergeState | null = null;

  constructor(options: RepositoryOptions) {
    this.storage = options.storage;
    this.workingTree = options.workingTree;
    this.author = options.author?.trim() || "Chronicle User";
    this.defaultBranch = options.defaultBranch ?? "main";
    validateBranchName(this.defaultBranch);
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Loads the repository head. A brand-new workspace has no commits and no
   * RefState yet; the first commit creates the default branch as its root.
   */
  async init(): Promise<RefState | null> {
    return this.storage.getRefs();
  }

  async getRefs(): Promise<RefState | null> {
    return this.storage.getRefs();
  }

  async getActiveBranch(): Promise<string | null> {
    const refs = await this.storage.getRefs();
    return refs?.head.type === "branch" ? refs.head.name : null;
  }

  async listBranches(): Promise<Record<string, Sha256Hash>> {
    const refs = await this.storage.getRefs();
    return refs ? compareBranches(refs) : {};
  }

  getPendingMerge(): PendingMergeState | null {
    if (!this.pendingMerge) return null;
    return {
      ...this.pendingMerge,
      conflictPaths: [...this.pendingMerge.conflictPaths],
    };
  }

  async getHeadCommit(): Promise<CommitObject | null> {
    const hash = this.headHash(await this.storage.getRefs());
    return hash ? getCommit(this.storage, hash) : null;
  }

  async resolveRevision(revision: string): Promise<Sha256Hash> {
    const refs = await this.storage.getRefs();

    if (revision === "HEAD") {
      const hash = this.headHash(refs);
      if (!hash) throw new NoHeadError();
      return hash;
    }

    if (refs && Object.prototype.hasOwnProperty.call(refs.branches, revision)) {
      const hash = refs.branches[revision];
      if (hash) return hash;
    }

    if (isSha256Hash(revision) && (await this.storage.hasObject(revision))) {
      return revision;
    }

    throw new RevisionNotFoundError(revision);
  }

  /** Compares the working tree (or any supplied map) against HEAD. */
  async status(options: DiffOptions = {}): Promise<WorkingFileDiff[]> {
    const refs = await this.storage.getRefs();
    const workingFiles = await this.readWorkingFiles();
    const baseHash = this.headHash(refs);

    if (!baseHash) {
      return diffFileMaps({}, workingFiles, options);
    }

    const baseFiles = await loadTreeFiles(this.storage, baseHash);
    return diffFileMaps(baseFiles, workingFiles, options);
  }

  async log(options: LogOptions = {}): Promise<CommitObject[]> {
    const hash = options.from
      ? await this.resolveRevision(options.from)
      : this.headHash(await this.storage.getRefs());

    if (!hash) return [];
    return getCommitHistory(this.storage, hash, { limit: options.limit });
  }

  async createBranch(
    name: string,
    options: { from?: string } = {},
  ): Promise<Sha256Hash> {
    validateBranchName(name);
    this.ensureNoMerge("create a branch");

    const refs = await this.storage.getRefs();
    if (!refs) throw new NoHeadError();

    const fromHash = options.from
      ? await this.resolveRevision(options.from)
      : this.headHash(refs);
    if (!fromHash) throw new NoHeadError();

    // Fail before mutating refs if the revision is not a commit.
    await getCommit(this.storage, fromHash);

    await this.storage.updateRefs((current) => {
      if (!current) throw new NoHeadError();
      if (
        Object.prototype.hasOwnProperty.call(current.branches, name)
      ) {
        throw new BranchAlreadyExistsError(name);
      }
      return {
        ...current,
        branches: { ...current.branches, [name]: fromHash },
      };
    });

    return fromHash;
  }

  async checkout(
    branchName: string,
    options: CheckoutOptions = {},
  ): Promise<RefState> {
    validateBranchName(branchName);
    this.ensureNoMerge("switch branches");

    const refs = await this.storage.getRefs();
    if (!refs) throw new NoHeadError();

    const targetHash = refs.branches[branchName];
    if (!targetHash) throw new BranchNotFoundError(branchName);

    const targetCommit = await getCommit(this.storage, targetHash);
    const targetFiles = await loadTreeFiles(this.storage, targetCommit.treeHash);

    if (!options.force) {
      await this.assertCleanWorkingTree(`switch to ${branchName}`);
    }

    const nextRefs = await this.storage.updateRefs((current) => {
      if (!current) throw new NoHeadError();
      if (!current.branches[branchName]) {
        throw new BranchNotFoundError(branchName);
      }
      return {
        ...current,
        head: { type: "branch", name: branchName },
      };
    });

    await this.hydrateWorkingTree(targetFiles);
    return nextRefs;
  }

  async commit(options: CommitOptions): Promise<CommitObject> {
    this.ensureNoMerge("create a normal commit");

    const message = options.message.trim();
    if (message === "") {
      throw new VcsError("Commit message must not be empty");
    }
    const author = (options.author ?? this.author).trim();
    if (author === "") {
      throw new VcsError("Commit author must not be empty");
    }

    const refs = await this.storage.getRefs();
    const headHash = this.headHash(refs);
    const headCommit = headHash
      ? await getCommit(this.storage, headHash)
      : null;

    const files = await this.readWorkingFiles();
    const { tree, blobs } = await this.buildTreeSnapshot(files);

    if (
      headCommit &&
      headCommit.treeHash === tree.hash &&
      !options.allowEmpty
    ) {
      throw new NothingToCommitError();
    }

    const commit = await this.createCommit({
      treeHash: tree.hash,
      parentHashes: headCommit ? [headCommit.hash] : [],
      message,
      author,
      timestamp: this.now(),
    });

    let nextRefs: RefState;
    if (!refs) {
      nextRefs = {
        head: { type: "branch", name: this.defaultBranch },
        branches: { [this.defaultBranch]: commit.hash },
      };
    } else if (refs.head.type === "branch") {
      nextRefs = {
        ...refs,
        branches: { ...refs.branches, [refs.head.name]: commit.hash },
      };
    } else {
      nextRefs = {
        ...refs,
        head: { type: "detached", commitHash: commit.hash },
      };
    }

    await this.storage.writeBatch({
      objects: [...blobs, tree, commit],
      refs: nextRefs,
    });

    return commit;
  }

  /**
   * Merges `sourceBranch` into the current branch.
   *
   * - ALREADY_UP_TO_DATE when source is an ancestor of the target
   * - FAST_FORWARD when the target is an ancestor of source
   * - MERGED_CLEAN after a successful LCA-based three-way merge commit
   * - CONFLICT with marker files, leaving a pending merge to complete/abort
   */
  async merge(
    sourceBranch: string,
    options: MergeOptions = {},
  ): Promise<MergeOutcome> {
    validateBranchName(sourceBranch);
    this.ensureNoMerge("start a merge");

    const refs = await this.storage.getRefs();
    if (!refs) throw new NoHeadError();
    if (refs.head.type !== "branch") throw new DetachedHeadError("merge");

    const targetBranch = refs.head.name;
    const targetHash = refs.branches[targetBranch];
    if (!targetHash) throw new BranchNotFoundError(targetBranch);

    const sourceHash = refs.branches[sourceBranch];
    if (!sourceHash) throw new BranchNotFoundError(sourceBranch);

    if (sourceBranch === targetBranch || sourceHash === targetHash) {
      return { status: "ALREADY_UP_TO_DATE" };
    }

    if (await isAncestor(this.storage, sourceHash, targetHash)) {
      return { status: "ALREADY_UP_TO_DATE" };
    }

    if (!options.force) {
      await this.assertCleanWorkingTree(
        `merge ${sourceBranch} into ${targetBranch}`,
      );
    }

    if (await isAncestor(this.storage, targetHash, sourceHash)) {
      const files = await loadTreeFiles(this.storage, sourceHash);
      const nextRefs: RefState = {
        ...refs,
        branches: { ...refs.branches, [targetBranch]: sourceHash },
      };
      await this.storage.writeBatch({ refs: nextRefs });
      await this.hydrateWorkingTree(files);
      return { status: "FAST_FORWARD", commitHash: sourceHash };
    }

    const baseCommit = await findLCA(this.storage, targetHash, sourceHash);
    if (!baseCommit) {
      throw new UnrelatedHistoriesError(targetHash, sourceHash);
    }

    const [baseFiles, oursFiles, theirsFiles] = await Promise.all([
      loadTreeFiles(this.storage, baseCommit.treeHash),
      loadTreeFiles(this.storage, targetHash),
      loadTreeFiles(this.storage, sourceHash),
    ]);

    const mergeResult = threeWayMerge(baseFiles, oursFiles, theirsFiles, {
      oursLabel: "HEAD",
      theirsLabel: sourceBranch,
    });

    if (mergeResult.hasConflicts) {
      const mergedFiles: Record<string, string> = {
        ...mergeResult.resolvedFiles,
      };
      for (const conflict of mergeResult.conflictFiles) {
        mergedFiles[conflict.path] = conflict.mergedWithMarkers;
      }

      await this.hydrateWorkingTree(mergedFiles);
      this.pendingMerge = {
        sourceBranch,
        targetBranch,
        baseCommitHash: baseCommit.hash,
        sourceCommitHash: sourceHash,
        targetCommitHash: targetHash,
        conflictPaths: mergeResult.conflictFiles.map(
          (conflict) => conflict.path,
        ),
      };

      return {
        status: "CONFLICT",
        sourceBranch,
        targetBranch,
        baseCommitHash: baseCommit.hash,
        sourceCommitHash: sourceHash,
        resolvedFiles: mergeResult.resolvedFiles,
        conflictFiles: mergeResult.conflictFiles,
      };
    }

    const message = (
      options.message ??
      `Merge branch '${sourceBranch}' into ${targetBranch}`
    ).trim();
    const author = (options.author ?? this.author).trim();

    const commit = await this.commitMergedSnapshot({
      files: mergeResult.resolvedFiles,
      parentHashes: [targetHash, sourceHash],
      message,
      author,
      targetBranch,
      expectedTargetHash: targetHash,
    });

    await this.hydrateWorkingTree(mergeResult.resolvedFiles);

    return { status: "MERGED_CLEAN", commitHash: commit.hash };
  }

  /**
   * Finalizes a conflicted merge. By default the current working tree is
   * committed, allowing the editor to resolve markers in place; an explicit
   * `files` snapshot is accepted for programmatic resolution.
   */
  async completeMergeCommit(
    options: CompleteMergeOptions = {},
  ): Promise<CommitObject> {
    const pending = this.pendingMerge;
    if (!pending) throw new NoPendingMergeError();

    const refs = await this.storage.getRefs();
    if (
      !refs ||
      refs.head.type !== "branch" ||
      refs.head.name !== pending.targetBranch
    ) {
      throw new MergeInProgressError(
        `HEAD is no longer on ${JSON.stringify(pending.targetBranch)}`,
      );
    }

    const files =
      options.files !== undefined
        ? normalizeFiles(options.files)
        : await this.readWorkingFiles();

    const unresolved = findConflictMarkerPaths(files);
    if (unresolved.length > 0) {
      throw new UnresolvedConflictsError(unresolved);
    }

    const message = (
      options.message ??
      `Merge branch '${pending.sourceBranch}' into ${pending.targetBranch}`
    ).trim();
    const author = (options.author ?? this.author).trim();

    const commit = await this.commitMergedSnapshot({
      files,
      parentHashes: [pending.targetCommitHash, pending.sourceCommitHash],
      message,
      author,
      targetBranch: pending.targetBranch,
      expectedTargetHash: pending.targetCommitHash,
    });

    await this.hydrateWorkingTree(files);
    this.pendingMerge = null;
    return commit;
  }

  /** Discards an in-progress conflicted merge and restores the target tree. */
  async abortMerge(): Promise<void> {
    const pending = this.pendingMerge;
    if (!pending) throw new NoPendingMergeError();

    const refs = await this.storage.getRefs();
    const targetHash =
      refs?.branches[pending.targetBranch] ?? pending.targetCommitHash;
    const files = await loadTreeFiles(this.storage, targetHash);

    await this.hydrateWorkingTree(files);
    this.pendingMerge = null;
  }

  /**
   * Moves the current branch (or detached HEAD) to a commit. Soft reset keeps
   * the working tree; hard reset replaces it with the target snapshot.
   */
  async reset(
    commitHash: Sha256Hash,
    options: ResetOptions = {},
  ): Promise<RefState> {
    const commit = await getCommit(this.storage, commitHash);
    const refs = await this.storage.getRefs();
    if (!refs) throw new NoHeadError();

    const nextRefs: RefState =
      refs.head.type === "branch"
        ? {
            ...refs,
            branches: { ...refs.branches, [refs.head.name]: commit.hash },
          }
        : {
            ...refs,
            head: { type: "detached", commitHash: commit.hash },
          };

    await this.storage.writeBatch({ refs: nextRefs });

    if (options.hard) {
      const files = await loadTreeFiles(this.storage, commit.treeHash);
      await this.hydrateWorkingTree(files);
    }

    this.pendingMerge = null;
    return nextRefs;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private headHash(refs: RefState | null): Sha256Hash | null {
    if (!refs) return null;
    if (refs.head.type === "detached") return refs.head.commitHash;

    const hash = refs.branches[refs.head.name];
    if (!hash) throw new BranchNotFoundError(refs.head.name);
    return hash;
  }

  private ensureNoMerge(action: string): void {
    if (this.pendingMerge) {
      throw new MergeInProgressError(
        `Cannot ${action} while a merge is in progress; complete or abort it first`,
      );
    }
  }

  private async readWorkingFiles(): Promise<Record<string, string>> {
    return normalizeFiles(await this.workingTree.readFiles());
  }

  private async hydrateWorkingTree(
    files: Readonly<Record<string, string>>,
  ): Promise<void> {
    await this.workingTree.hydrateFromTree(normalizeFiles(files));
  }

  private async assertCleanWorkingTree(action: string): Promise<void> {
    const changes = await this.status({ includeUnmodified: false });
    if (changes.length > 0) {
      throw new DirtyWorkingTreeError(
        changes.map((change) => change.path),
        action,
      );
    }
  }

  private async buildTreeSnapshot(
    files: Readonly<Record<string, string>>,
  ): Promise<{ tree: TreeObject; blobs: StoredObject[] }> {
    const normalized = normalizeFiles(files);
    const blobs: StoredObject[] = [];
    const blobsByHash = new Map<Sha256Hash, BlobObject>();
    const entries: Record<string, Sha256Hash> = {};

    for (const [path, content] of Object.entries(normalized)) {
      const payload = {
        type: "blob" as const,
        content,
        byteLength: utf8ByteLength(content),
      };
      const hash = await hashObjectPayload(payload);

      let blob = blobsByHash.get(hash);
      if (!blob) {
        blob = { ...payload, hash };
        blobsByHash.set(hash, blob);
        blobs.push(blob);
      }

      entries[path] = hash;
    }

    const treePayload = { type: "tree" as const, entries };
    const treeHash = await hashObjectPayload(treePayload);
    const tree: TreeObject = { ...treePayload, hash: treeHash };

    return { tree, blobs };
  }

  private async createCommit(input: {
    treeHash: Sha256Hash;
    parentHashes: readonly Sha256Hash[];
    message: string;
    author: string;
    timestamp: number;
  }): Promise<CommitObject> {
    const timestamp = Math.trunc(input.timestamp);
    if (!Number.isFinite(timestamp)) {
      throw new VcsError("Commit timestamp must be a finite number");
    }

    const payload = {
      type: "commit" as const,
      treeHash: input.treeHash,
      parentHashes: [...input.parentHashes],
      message: input.message,
      author: input.author,
      timestamp,
    };

    return { ...payload, hash: await hashObjectPayload(payload) };
  }

  private async commitMergedSnapshot(input: {
    files: Readonly<Record<string, string>>;
    parentHashes: readonly Sha256Hash[];
    message: string;
    author: string;
    targetBranch: string;
    expectedTargetHash: Sha256Hash;
  }): Promise<CommitObject> {
    if (input.message === "") {
      throw new VcsError("Merge commit message must not be empty");
    }
    if (input.author === "") {
      throw new VcsError("Merge commit author must not be empty");
    }

    const { tree, blobs } = await this.buildTreeSnapshot(input.files);
    const commit = await this.createCommit({
      treeHash: tree.hash,
      parentHashes: input.parentHashes,
      message: input.message,
      author: input.author,
      timestamp: this.now(),
    });

    const refs = await this.storage.getRefs();
    if (!refs) throw new NoHeadError();

    const currentTarget = refs.branches[input.targetBranch];
    if (!currentTarget) {
      throw new BranchNotFoundError(input.targetBranch);
    }
    if (currentTarget !== input.expectedTargetHash) {
      throw new MergeTargetMovedError(input.targetBranch);
    }

    const nextRefs: RefState = {
      ...refs,
      branches: {
        ...refs.branches,
        [input.targetBranch]: commit.hash,
      },
    };

    await this.storage.writeBatch({
      objects: [...blobs, tree, commit],
      refs: nextRefs,
    });

    return commit;
  }
}
