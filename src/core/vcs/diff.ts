/**
 * Line-level diffing with Myers' algorithm (jsdiff) and file-level change
 * classification for trees, commits, and the live working tree.
 */

import { diffLines } from "diff";

import type { IObjectStorage } from "../cas/ObjectStore";
import type {
  CommitObject,
  Sha256Hash,
  TreeObject,
  WorkingFileDiff,
} from "../types";
import { MissingObjectError, UnexpectedObjectTypeError } from "./errors";

export type FileContents = Readonly<Record<string, string>>;

/** Anything that can be resolved to a tree snapshot. */
export type TreeLike = TreeObject | CommitObject | Sha256Hash | null | undefined;

export interface DiffOptions {
  /**
   * Include files whose contents are identical. Defaults to true so the
   * sidebar can render a complete file list; pass false for change-only views.
   */
  includeUnmodified?: boolean;
}

export interface LineDiffHunk {
  value: string;
  added: boolean;
  removed: boolean;
  count: number;
}

/** Raw Myers line hunks for the DiffViewer. */
export function diffTextLines(
  baseContent: string,
  workingContent: string,
): LineDiffHunk[] {
  return diffLines(baseContent, workingContent).map((change) => ({
    value: change.value,
    added: change.added,
    removed: change.removed,
    count: change.count,
  }));
}

/**
 * Computes file-level diffs between two content maps. Uses the Myers line
 * diff to decide whether equal-status files actually differ.
 */
export function diffFileMaps(
  baseFiles: FileContents,
  workingFiles: FileContents,
  options: DiffOptions = {},
): WorkingFileDiff[] {
  const includeUnmodified = options.includeUnmodified ?? true;
  const paths = [
    ...new Set([...Object.keys(baseFiles), ...Object.keys(workingFiles)]),
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const diffs: WorkingFileDiff[] = [];

  for (const path of paths) {
    const baseContent = baseFiles[path];
    const workingContent = workingFiles[path];

    let status: WorkingFileDiff["status"];
    if (baseContent === undefined) {
      status = "ADDED";
    } else if (workingContent === undefined) {
      status = "DELETED";
    } else if (baseContent === workingContent) {
      status = "UNMODIFIED";
    } else {
      const changed = diffTextLines(baseContent, workingContent).some(
        (hunk) => hunk.added || hunk.removed,
      );
      status = changed ? "MODIFIED" : "UNMODIFIED";
    }

    if (status === "UNMODIFIED" && !includeUnmodified) continue;

    diffs.push({
      path,
      status,
      baseContent: baseContent ?? "",
      workingContent: workingContent ?? "",
    });
  }

  return diffs;
}

async function resolveTree(
  storage: IObjectStorage,
  ref: TreeLike,
): Promise<TreeObject | null> {
  if (!ref) return null;

  if (typeof ref === "string") {
    const object = await storage.getObject(ref);
    if (!object) throw new MissingObjectError(ref, "tree or commit");
    if (object.type === "tree") return object;
    if (object.type === "commit") {
      const tree = await storage.getObject(object.treeHash);
      if (!tree) throw new MissingObjectError(object.treeHash, "tree");
      if (tree.type !== "tree") {
        throw new UnexpectedObjectTypeError(object.treeHash, "tree", tree.type);
      }
      return tree;
    }
    throw new UnexpectedObjectTypeError(ref, "tree or commit", object.type);
  }

  if (ref.type === "commit") {
    const tree = await storage.getObject(ref.treeHash);
    if (!tree) throw new MissingObjectError(ref.treeHash, "tree");
    if (tree.type !== "tree") {
      throw new UnexpectedObjectTypeError(ref.treeHash, "tree", tree.type);
    }
    return tree;
  }

  return ref;
}

/**
 * Loads every file's materialized content from a tree, commit, or hash.
 * Blob reads are batched through `getObjects`; results are keyed in sorted
 * path order for deterministic commit snapshots.
 */
export async function loadTreeFiles(
  storage: IObjectStorage,
  ref: TreeLike,
): Promise<Record<string, string>> {
  const tree = await resolveTree(storage, ref);
  if (!tree) return {};

  const entries = Object.entries(tree.entries).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const blobs = await storage.getObjects(entries.map(([, hash]) => hash));
  const files: Record<string, string> = {};

  for (const [path, blobHash] of entries) {
    const blob = blobs.get(blobHash);
    if (!blob) throw new MissingObjectError(blobHash, "blob");
    if (blob.type !== "blob") {
      throw new UnexpectedObjectTypeError(blobHash, "blob", blob.type);
    }
    files[path] = blob.content;
  }

  return files;
}

/** Diffs two committed snapshots (trees, commits, or hashes). */
export async function diffTrees(
  storage: IObjectStorage,
  base: TreeLike,
  target: TreeLike,
  options: DiffOptions = {},
): Promise<WorkingFileDiff[]> {
  const [baseFiles, targetFiles] = await Promise.all([
    loadTreeFiles(storage, base),
    loadTreeFiles(storage, target),
  ]);
  return diffFileMaps(baseFiles, targetFiles, options);
}

/** Diffs HEAD (or any tree-like base) against the live working file map. */
export async function diffWorkingTree(
  storage: IObjectStorage,
  head: TreeLike,
  workingFiles: FileContents,
  options: DiffOptions = {},
): Promise<WorkingFileDiff[]> {
  const baseFiles = await loadTreeFiles(storage, head);
  return diffFileMaps(baseFiles, workingFiles, options);
}
