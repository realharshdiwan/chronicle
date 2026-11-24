/**
 * Core data model for the local-first Git-style workspace.
 *
 * This file is pure TypeScript: no React, no DOM, no browser globals beyond
 * the standard library types. Every persisted object is immutable and
 * addressed by the SHA-256 hash of its canonical JSON payload.
 */

/** A 64-character lowercase hexadecimal SHA-256 digest. */
export type Sha256Hash = string;

export interface BlobObject {
  type: "blob";
  hash: Sha256Hash;
  content: string;
  /** UTF-8 byte length of `content`; part of the hashed payload. */
  byteLength: number;
}

export interface TreeObject {
  type: "tree";
  hash: Sha256Hash;
  /** Sorted filePath -> blobHash. */
  entries: Record<string, Sha256Hash>;
}

export interface CommitObject {
  type: "commit";
  hash: Sha256Hash;
  treeHash: Sha256Hash;
  /** [] for root, [p1] for normal, [p1, p2] for a merge commit. */
  parentHashes: Sha256Hash[];
  message: string;
  author: string;
  timestamp: number;
}

export type StoredObject = BlobObject | TreeObject | CommitObject;

export interface RefState {
  head:
    | { type: "branch"; name: string }
    | { type: "detached"; commitHash: Sha256Hash };
  /** branchName -> commitHash */
  branches: Record<string, Sha256Hash>;
}

export type FileChangeStatus =
  | "ADDED"
  | "MODIFIED"
  | "DELETED"
  | "UNMODIFIED";

export interface WorkingFileDiff {
  path: string;
  status: FileChangeStatus;
  baseContent: string;
  workingContent: string;
}

export interface MergeConflictFile {
  path: string;
  baseContent: string;
  oursContent: string;
  theirsContent: string;
  mergedWithMarkers: string;
}

export type MergeOutcome =
  | { status: "ALREADY_UP_TO_DATE" }
  | { status: "FAST_FORWARD"; commitHash: Sha256Hash }
  | { status: "MERGED_CLEAN"; commitHash: Sha256Hash }
  | {
      status: "CONFLICT";
      sourceBranch: string;
      targetBranch: string;
      baseCommitHash: Sha256Hash;
      sourceCommitHash: Sha256Hash;
      resolvedFiles: Record<string, string>;
      conflictFiles: MergeConflictFile[];
    };

export interface StorageTelemetry {
  blobCount: number;
  treeCount: number;
  commitCount: number;
  /** Sum of all file bytes across all historical commit snapshots. */
  logicalBytes: number;
  /** Actual unique blob bytes stored in IndexedDB. */
  deduplicatedBytes: number;
  /** 1 - (deduplicatedBytes / logicalBytes); 0 when history is empty. */
  deduplicationRatio: number;
  lastWriteLatencyMs: number;
}
