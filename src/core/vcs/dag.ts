import type { IObjectStorage } from '../cas/ObjectStore';
import type { CommitObject } from '../types';

/**
 * Loads a commit object from storage, returning null if missing or non-commit.
 */
async function getCommit(
  storage: IObjectStorage,
  hash: string
): Promise<CommitObject | null> {
  const obj = await storage.getObject(hash);
  if (!obj || obj.type !== 'commit') return null;
  return obj;
}

/**
 * Iterative topological / reverse-chronological history traversal from given starting hashes.
 */
export async function getCommitHistory(
  storage: IObjectStorage,
  startHashes: string[],
  limit?: number
): Promise<CommitObject[]> {
  const commits = new Map<string, CommitObject>();
  const queue = [...startHashes];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const hash = queue.shift()!;
    if (visited.has(hash)) continue;
    visited.add(hash);

    const commit = await getCommit(storage, hash);
    if (!commit) continue;

    commits.set(hash, commit);
    for (const parentHash of commit.parentHashes) {
      if (!visited.has(parentHash)) {
        queue.push(parentHash);
      }
    }
  }

  // Kahn's topological sort biased toward newest timestamp first
  const childrenCount = new Map<string, number>();
  for (const hash of commits.keys()) {
    childrenCount.set(hash, 0);
  }
  for (const commit of commits.values()) {
    for (const parentHash of commit.parentHashes) {
      if (commits.has(parentHash)) {
        childrenCount.set(parentHash, (childrenCount.get(parentHash) ?? 0) + 1);
      }
    }
  }

  const ready: CommitObject[] = [];
  for (const [hash, count] of childrenCount.entries()) {
    if (count === 0) {
      const c = commits.get(hash);
      if (c) ready.push(c);
    }
  }

  const ordered: CommitObject[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      return a.hash.localeCompare(b.hash);
    });

    const current = ready.shift()!;
    ordered.push(current);
    if (limit !== undefined && ordered.length >= limit) {
      return ordered;
    }

    for (const parentHash of current.parentHashes) {
      if (!commits.has(parentHash)) continue;
      const nextCount = (childrenCount.get(parentHash) ?? 0) - 1;
      childrenCount.set(parentHash, nextCount);
      if (nextCount === 0) {
        const parent = commits.get(parentHash);
        if (parent) ready.push(parent);
      }
    }
  }

  return ordered;
}

/**
 * Checks whether ancestorHash is reachable by walking parent pointers from descendantHash.
 */
export async function isAncestor(
  storage: IObjectStorage,
  ancestorHash: string,
  descendantHash: string
): Promise<boolean> {
  if (ancestorHash === descendantHash) return true;
  const visited = new Set<string>();
  const queue: string[] = [descendantHash];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === ancestorHash) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const commit = await getCommit(storage, current);
    if (!commit) continue;
    for (const parentHash of commit.parentHashes) {
      if (!visited.has(parentHash)) {
        queue.push(parentHash);
      }
    }
  }

  return false;
}

async function computeAncestorDistances(
  storage: IObjectStorage,
  startHash: string
): Promise<Map<string, number>> {
  const distances = new Map<string, number>();
  const queue: Array<{ hash: string; dist: number }> = [
    { hash: startHash, dist: 0 },
  ];

  while (queue.length > 0) {
    const { hash, dist } = queue.shift()!;
    const prev = distances.get(hash);
    if (prev !== undefined && prev <= dist) continue;
    distances.set(hash, dist);

    const commit = await getCommit(storage, hash);
    if (!commit) continue;
    for (const parentHash of commit.parentHashes) {
      queue.push({ hash: parentHash, dist: dist + 1 });
    }
  }

  return distances;
}

/**
 * Deterministic Lowest Common Ancestor (LCA) via bidirectional BFS with
 * dominance filtering (removing candidates that are strict ancestors of other candidates)
 * and deterministic ranking (total distance -> recency -> hash).
 */
export async function findLCA(
  storage: IObjectStorage,
  commitA: string,
  commitB: string
): Promise<string | null> {
  if (commitA === commitB) return commitA;

  const [distA, distB] = await Promise.all([
    computeAncestorDistances(storage, commitA),
    computeAncestorDistances(storage, commitB),
  ]);

  const commonHashes: string[] = [];
  for (const hash of distA.keys()) {
    if (distB.has(hash)) {
      commonHashes.push(hash);
    }
  }

  if (commonHashes.length === 0) return null;

  // Dominance filtering: discard any common ancestor X that is a strict ancestor of another common ancestor Y
  const dominated = new Set<string>();
  for (let i = 0; i < commonHashes.length; i++) {
    const candidate = commonHashes[i];
    if (dominated.has(candidate)) continue;
    for (let j = 0; j < commonHashes.length; j++) {
      if (i === j) continue;
      const other = commonHashes[j];
      if (dominated.has(other)) continue;
      if (await isAncestor(storage, candidate, other)) {
        dominated.add(candidate);
        break;
      }
    }
  }

  const maximal = commonHashes.filter((h) => !dominated.has(h));
  if (maximal.length === 1) return maximal[0];

  // Deterministic tie-breaker for criss-cross merges: total distance -> timestamp -> hash
  const scored = await Promise.all(
    maximal.map(async (hash) => {
      const commit = await getCommit(storage, hash);
      const totalDist = (distA.get(hash) ?? 0) + (distB.get(hash) ?? 0);
      return {
        hash,
        totalDist,
        timestamp: commit?.timestamp ?? 0,
      };
    })
  );

  scored.sort((a, b) => {
    if (a.totalDist !== b.totalDist) return a.totalDist - b.totalDist;
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return a.hash.localeCompare(b.hash);
  });

  return scored[0]?.hash ?? null;
}
