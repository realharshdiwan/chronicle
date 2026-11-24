/**
 * Merkle-DAG traversal and Lowest Common Ancestor search.
 *
 * All traversal is by parentHashes only; commit hashes are content addresses,
 * so the graph cannot contain forged ancestry without breaking CAS integrity.
 */

import type { IObjectStorage } from "../cas/ObjectStore";
import type { CommitObject, Sha256Hash } from "../types";
import {
  DagIntegrityError,
  MissingObjectError,
  UnexpectedObjectTypeError,
} from "./errors";

export interface CommitHistoryOptions {
  /** Return at most this many commits, newest first. */
  limit?: number;
}

type CommitCache = Map<Sha256Hash, CommitObject>;

async function loadCommit(
  storage: IObjectStorage,
  hash: Sha256Hash,
  cache: CommitCache,
): Promise<CommitObject> {
  const cached = cache.get(hash);
  if (cached) return cached;

  const object = await storage.getObject(hash);
  if (!object) throw new MissingObjectError(hash, "commit");
  if (object.type !== "commit") {
    throw new UnexpectedObjectTypeError(hash, "commit", object.type);
  }

  cache.set(hash, object);
  return object;
}

/** Loads one commit, validating its type. */
export async function getCommit(
  storage: IObjectStorage,
  hash: Sha256Hash,
): Promise<CommitObject> {
  return loadCommit(storage, hash, new Map());
}

/**
 * Walks the ancestor graph rooted at `startHash` and returns a deterministic
 * topological order, newest first. Every commit appears before each of its
 * parents, including across merge edges.
 *
 * The implementation uses an iterative DFS post-order followed by a reversal
 * (a standard O(V+E) topological sort) rather than recursion, so very deep
 * histories cannot overflow the JS stack.
 */
export async function getCommitHistory(
  storage: IObjectStorage,
  startHash: Sha256Hash,
  options: CommitHistoryOptions = {},
): Promise<CommitObject[]> {
  const limit = options.limit;
  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) return [];

  const cache: CommitCache = new Map();
  const visited = new Set<Sha256Hash>();
  const postorder: CommitObject[] = [];
  const stack: Array<{ hash: Sha256Hash; expanded: boolean }> = [
    { hash: startHash, expanded: false },
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;

    if (frame.expanded) {
      const commit = cache.get(frame.hash);
      if (commit) postorder.push(commit);
      continue;
    }

    if (visited.has(frame.hash)) continue;
    visited.add(frame.hash);

    const commit = await loadCommit(storage, frame.hash, cache);
    stack.push({ hash: frame.hash, expanded: true });
    // Pushing parents in natural order means the first parent is expanded
    // first after the reversal, matching Git's first-parent-first intuition.
    for (const parentHash of commit.parentHashes) {
      if (!visited.has(parentHash)) {
        stack.push({ hash: parentHash, expanded: false });
      }
    }
  }

  postorder.reverse();

  if (limit !== undefined) return postorder.slice(0, Math.floor(limit));
  return postorder;
}

/**
 * Bidirectional BFS over ancestor generations.
 *
 * Both sides advance one generation at a time, recording each ancestor's
 * shortest distance from its starting commit. Intersections are candidate
 * common ancestors; candidates that are themselves ancestors of another
 * candidate are dominated and discarded. This handles criss-cross histories
 * where simply taking the first intersection can return a commit that is
 * older than the true merge base.
 */
async function ancestorDistances(
  storage: IObjectStorage,
  startHash: Sha256Hash,
  cache: CommitCache,
): Promise<Map<Sha256Hash, number>> {
  const distances = new Map<Sha256Hash, number>([[startHash, 0]]);
  let frontier: Sha256Hash[] = [startHash];
  let depth = 0;

  while (frontier.length > 0) {
    depth += 1;
    const next: Sha256Hash[] = [];

    for (const hash of frontier) {
      const commit = await loadCommit(storage, hash, cache);
      for (const parentHash of commit.parentHashes) {
        if (!distances.has(parentHash)) {
          distances.set(parentHash, depth);
          next.push(parentHash);
        }
      }
    }

    frontier = next;
  }

  return distances;
}

async function ancestorHashes(
  storage: IObjectStorage,
  startHash: Sha256Hash,
  cache: CommitCache,
): Promise<Set<Sha256Hash>> {
  const visited = new Set<Sha256Hash>([startHash]);
  const stack: Sha256Hash[] = [startHash];

  while (stack.length > 0) {
    const hash = stack.pop();
    if (!hash) break;
    const commit = await loadCommit(storage, hash, cache);
    for (const parentHash of commit.parentHashes) {
      if (!visited.has(parentHash)) {
        visited.add(parentHash);
        stack.push(parentHash);
      }
    }
  }

  return visited;
}

/**
 * Returns the best common ancestor of two commits, or null when their
 * histories are unrelated. Multiple "best" candidates (criss-cross merges)
 * are ranked deterministically by proximity, then recency, then hash.
 */
export async function findLCA(
  storage: IObjectStorage,
  commitA: Sha256Hash,
  commitB: Sha256Hash,
): Promise<CommitObject | null> {
  const cache: CommitCache = new Map();
  const [distancesA, distancesB] = await Promise.all([
    ancestorDistances(storage, commitA, cache),
    ancestorDistances(storage, commitB, cache),
  ]);

  const candidates = [...distancesA.keys()].filter((hash) =>
    distancesB.has(hash),
  );
  if (candidates.length === 0) return null;

  const candidateSet = new Set(candidates);
  const dominated = new Set<Sha256Hash>();

  for (const candidate of candidates) {
    const ancestors = await ancestorHashes(storage, candidate, cache);
    for (const ancestor of ancestors) {
      if (ancestor !== candidate && candidateSet.has(ancestor)) {
        dominated.add(ancestor);
      }
    }
  }

  const best = candidates.filter((hash) => !dominated.has(hash));
  const ranked: Array<{
    commit: CommitObject;
    maxDepth: number;
    sumDepth: number;
  }> = [];

  for (const hash of best) {
    const commit = await loadCommit(storage, hash, cache);
    const distanceA = distancesA.get(hash) ?? Number.POSITIVE_INFINITY;
    const distanceB = distancesB.get(hash) ?? Number.POSITIVE_INFINITY;
    ranked.push({
      commit,
      maxDepth: Math.max(distanceA, distanceB),
      sumDepth: distanceA + distanceB,
    });
  }

  ranked.sort((left, right) => {
    if (left.maxDepth !== right.maxDepth) return left.maxDepth - right.maxDepth;
    if (left.sumDepth !== right.sumDepth) return left.sumDepth - right.sumDepth;
    if (left.commit.timestamp !== right.commit.timestamp) {
      return right.commit.timestamp - left.commit.timestamp;
    }
    return left.commit.hash < right.commit.hash ? -1 : 1;
  });

  return ranked[0]?.commit ?? null;
}

/** True when `ancestorHash` is reachable by following parents from `descendantHash`. */
export async function isAncestor(
  storage: IObjectStorage,
  ancestorHash: Sha256Hash,
  descendantHash: Sha256Hash,
): Promise<boolean> {
  if (ancestorHash === descendantHash) return true;

  const cache: CommitCache = new Map();
  const visited = new Set<Sha256Hash>([descendantHash]);
  const stack: Sha256Hash[] = [descendantHash];

  while (stack.length > 0) {
    const hash = stack.pop();
    if (!hash) break;
    const commit = await loadCommit(storage, hash, cache);

    for (const parentHash of commit.parentHashes) {
      if (parentHash === ancestorHash) return true;
      if (!visited.has(parentHash)) {
        visited.add(parentHash);
        stack.push(parentHash);
      }
    }
  }

  return false;
}

/**
 * Ensures the graph reachable from `startHash` is closed: every parent link
 * resolves to a commit. Useful before rendering the DAG in the X-Ray drawer.
 */
export async function assertCompleteHistory(
  storage: IObjectStorage,
  startHash: Sha256Hash,
): Promise<void> {
  const commits = await getCommitHistory(storage, startHash);
  const seen = new Set(commits.map((commit) => commit.hash));
  for (const commit of commits) {
    for (const parentHash of commit.parentHashes) {
      if (!seen.has(parentHash)) {
        throw new DagIntegrityError(
          `Commit ${commit.hash.slice(0, 12)}… references missing parent ${parentHash.slice(0, 12)}…`,
        );
      }
    }
  }
}
