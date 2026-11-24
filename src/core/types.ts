export type CASObjectType = 'blob' | 'tree' | 'commit';

export interface BlobObject {
  type: 'blob';
  hash: string;
  content: string;
  byteLength: number;
}

export interface TreeObject {
  type: 'tree';
  hash: string;
  entries: Record<string, string>;
}

export interface CommitObject {
  type: 'commit';
  hash: string;
  treeHash: string;
  parentHashes: string[];
  message: string;
  author: string;
  timestamp: number;
}

export type CASObject = BlobObject | TreeObject | CommitObject;

export type HeadRef =
  | { type: 'branch'; branch: string }
  | { type: 'detached'; commitHash: string };

export interface RefState {
  head: HeadRef;
  branches: Record<string, string>;
}

export type MergeOutcome =
  | 'ALREADY_UP_TO_DATE'
  | 'FAST_FORWARD'
  | 'MERGED_CLEAN'
  | 'CONFLICT';

export type FileChangeStatus = 'modified' | 'added' | 'deleted' | 'conflicted';

export interface WorkingTreeStatus {
  clean: boolean;
  modified: string[];
  added: string[];
  deleted: string[];
  conflicted: string[];
  changes: Record<string, FileChangeStatus>;
}

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLineNo: number | null;
  newLineNo: number | null;
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface ConflictRegion {
  index: number;
  startLine: number;
  midLine: number;
  endLine: number;
  oursLabel: string;
  theirsLabel: string;
  oursLines: string[];
  theirsLines: string[];
}

export interface PendingMergeState {
  targetBranch: string;
  targetCommitHash: string;
  lcaCommitHash: string | null;
  conflictedFiles: string[];
}

export interface StorageTelemetry {
  blobCount: number;
  treeCount: number;
  commitCount: number;
  logicalBytes: number;
  deduplicatedBytes: number;
  deduplicationRatio: number;
  lastWriteLatencyMs: number;
  latencyHistoryMs: number[];
}

export interface ISyncTransport {
  send(message: unknown): void;
  subscribe(handler: (message: unknown) => void): () => void;
  close(): void;
}
