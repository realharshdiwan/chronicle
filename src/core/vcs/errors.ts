/**
 * Typed errors for the VCS engine. Kept separate from the pure CAS layer so
 * callers can distinguish storage corruption from user-facing Git semantics.
 */

import type { Sha256Hash } from "../types";

export class VcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VcsError";
  }
}

export class MissingObjectError extends VcsError {
  readonly hash: string;

  constructor(hash: string, expected = "object") {
    super(`Missing ${expected} object ${hash.slice(0, 12)}… in the object store`);
    this.name = "MissingObjectError";
    this.hash = hash;
  }
}

export class UnexpectedObjectTypeError extends VcsError {
  constructor(
    hash: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Object ${hash.slice(0, 12)}… is a ${actual}, expected a ${expected}`,
    );
    this.name = "UnexpectedObjectTypeError";
  }
}

export class DagIntegrityError extends VcsError {
  constructor(message: string) {
    super(message);
    this.name = "DagIntegrityError";
  }
}

export class InvalidBranchNameError extends VcsError {
  constructor(name: string) {
    super(`Invalid branch name ${JSON.stringify(name)}`);
    this.name = "InvalidBranchNameError";
  }
}

export class BranchNotFoundError extends VcsError {
  constructor(name: string) {
    super(`Branch ${JSON.stringify(name)} does not exist`);
    this.name = "BranchNotFoundError";
  }
}

export class BranchAlreadyExistsError extends VcsError {
  constructor(name: string) {
    super(`Branch ${JSON.stringify(name)} already exists`);
    this.name = "BranchAlreadyExistsError";
  }
}

export class RevisionNotFoundError extends VcsError {
  constructor(revision: string) {
    super(`Revision ${JSON.stringify(revision)} could not be resolved`);
    this.name = "RevisionNotFoundError";
  }
}

export class NoHeadError extends VcsError {
  constructor() {
    super("The repository has no commits yet");
    this.name = "NoHeadError";
  }
}

export class DetachedHeadError extends VcsError {
  constructor(action: string) {
    super(`Cannot ${action} while HEAD is detached`);
    this.name = "DetachedHeadError";
  }
}

export class DirtyWorkingTreeError extends VcsError {
  readonly changedPaths: readonly string[];

  constructor(changedPaths: readonly string[], action = "switch branches") {
    super(
      `Working tree has uncommitted changes; refusing to ${action}. Commit or discard changes to: ${changedPaths.join(", ")}`,
    );
    this.name = "DirtyWorkingTreeError";
    this.changedPaths = [...changedPaths];
  }
}

export class NothingToCommitError extends VcsError {
  constructor() {
    super("Nothing to commit: the working tree matches HEAD");
    this.name = "NothingToCommitError";
  }
}

export class MergeInProgressError extends VcsError {
  constructor(message = "A merge is already in progress") {
    super(message);
    this.name = "MergeInProgressError";
  }
}

export class NoPendingMergeError extends VcsError {
  constructor() {
    super("No merge is in progress");
    this.name = "NoPendingMergeError";
  }
}

export class UnresolvedConflictsError extends VcsError {
  readonly paths: readonly string[];

  constructor(paths: readonly string[]) {
    super(
      `Cannot commit merge: conflict markers remain in ${paths.join(", ")}`,
    );
    this.name = "UnresolvedConflictsError";
    this.paths = [...paths];
  }
}

export class UnrelatedHistoriesError extends VcsError {
  constructor(commitA: Sha256Hash, commitB: Sha256Hash) {
    super(
      `Commits ${commitA.slice(0, 12)}… and ${commitB.slice(0, 12)}… share no common ancestor`,
    );
    this.name = "UnrelatedHistoriesError";
  }
}

export class MergeTargetMovedError extends VcsError {
  constructor(branch: string) {
    super(`Branch ${JSON.stringify(branch)} moved while the merge was in progress`);
    this.name = "MergeTargetMovedError";
  }
}

export class InvalidWorkingTreeError extends VcsError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWorkingTreeError";
  }
}
