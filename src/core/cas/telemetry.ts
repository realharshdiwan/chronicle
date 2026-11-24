import type {
  BlobObject,
  CommitObject,
  StorageTelemetry,
  TreeObject,
} from '../types';
import type { IObjectStorage } from './ObjectStore';

export async function computeStorageTelemetry(
  storage: IObjectStorage,
  lastWriteLatencyMs = 0,
  latencyHistoryMs: number[] = []
): Promise<StorageTelemetry> {
  const allObjects = await storage.getAllObjects();

  const blobs = new Map<string, BlobObject>();
  const trees = new Map<string, TreeObject>();
  const commits: CommitObject[] = [];

  for (const obj of allObjects) {
    if (obj.type === 'blob') {
      blobs.set(obj.hash, obj);
    } else if (obj.type === 'tree') {
      trees.set(obj.hash, obj);
    } else if (obj.type === 'commit') {
      commits.push(obj);
    }
  }

  let deduplicatedBytes = 0;
  for (const blob of blobs.values()) {
    deduplicatedBytes += blob.byteLength;
  }

  let logicalBytes = 0;
  for (const commit of commits) {
    const tree = trees.get(commit.treeHash);
    if (!tree) continue;
    for (const blobHash of Object.values(tree.entries)) {
      const blob = blobs.get(blobHash);
      if (blob) {
        logicalBytes += blob.byteLength;
      }
    }
  }

  const deduplicationRatio =
    deduplicatedBytes > 0
      ? Number((logicalBytes / deduplicatedBytes).toFixed(2))
      : 1;

  return {
    blobCount: blobs.size,
    treeCount: trees.size,
    commitCount: commits.length,
    logicalBytes,
    deduplicatedBytes,
    deduplicationRatio,
    lastWriteLatencyMs: Number(lastWriteLatencyMs.toFixed(2)),
    latencyHistoryMs,
  };
}
