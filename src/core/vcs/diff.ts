import { structuredPatch } from 'diff';
import type { IObjectStorage } from '../cas/ObjectStore';
import type { DiffHunk, DiffLine, FileDiff } from '../types';

function computeFileDiff(
  path: string,
  oldContent: string | undefined,
  newContent: string | undefined
): FileDiff | null {
  if (oldContent === newContent) return null;

  const status: FileDiff['status'] =
    oldContent === undefined
      ? 'added'
      : newContent === undefined
        ? 'deleted'
        : 'modified';

  const oldText = oldContent ?? '';
  const newText = newContent ?? '';

  const patch = structuredPatch(path, path, oldText, newText, '', '', {
    context: 3,
  });

  let additions = 0;
  let deletions = 0;

  const hunks: DiffHunk[] = patch.hunks.map((h) => {
    let oldLine = h.oldStart;
    let newLine = h.newStart;
    const lines: DiffLine[] = [];

    for (const raw of h.lines) {
      if (raw.startsWith('\\')) {
        // Ignore "\ No newline at end of file" metadata marker
        continue;
      }
      const prefix = raw[0];
      const content = raw.slice(1);
      if (prefix === '+') {
        additions++;
        lines.push({
          type: 'add',
          oldLineNo: null,
          newLineNo: newLine++,
          content,
        });
      } else if (prefix === '-') {
        deletions++;
        lines.push({
          type: 'remove',
          oldLineNo: oldLine++,
          newLineNo: null,
          content,
        });
      } else {
        lines.push({
          type: 'context',
          oldLineNo: oldLine++,
          newLineNo: newLine++,
          content,
        });
      }
    }

    return {
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      lines,
    };
  });

  return {
    path,
    status,
    oldContent: oldText,
    newContent: newText,
    hunks,
    additions,
    deletions,
  };
}

export function diffFileMaps(
  baseFiles: Record<string, string>,
  targetFiles: Record<string, string>
): FileDiff[] {
  const allPaths = Array.from(
    new Set([...Object.keys(baseFiles), ...Object.keys(targetFiles)])
  ).sort();

  const diffs: FileDiff[] = [];
  for (const path of allPaths) {
    const fileDiff = computeFileDiff(path, baseFiles[path], targetFiles[path]);
    if (fileDiff) {
      diffs.push(fileDiff);
    }
  }
  return diffs;
}

export async function loadTreeFiles(
  storage: IObjectStorage,
  treeHash: string | null
): Promise<Record<string, string>> {
  if (!treeHash) return {};
  const treeObj = await storage.getObject(treeHash);
  if (!treeObj || treeObj.type !== 'tree') return {};

  const files: Record<string, string> = {};
  const entries = Object.entries(treeObj.entries);
  await Promise.all(
    entries.map(async ([path, blobHash]) => {
      const blob = await storage.getObject(blobHash);
      if (blob && blob.type === 'blob') {
        files[path] = blob.content;
      }
    })
  );
  return files;
}

export async function diffTrees(
  storage: IObjectStorage,
  baseTreeHash: string | null,
  targetTreeHash: string | null
): Promise<FileDiff[]> {
  const [baseFiles, targetFiles] = await Promise.all([
    loadTreeFiles(storage, baseTreeHash),
    loadTreeFiles(storage, targetTreeHash),
  ]);
  return diffFileMaps(baseFiles, targetFiles);
}

export async function diffWorkingTree(
  storage: IObjectStorage,
  headCommitHash: string | null,
  workingFiles: Record<string, string>
): Promise<FileDiff[]> {
  let treeHash: string | null = null;
  if (headCommitHash) {
    const commit = await storage.getObject(headCommitHash);
    if (commit && commit.type === 'commit') {
      treeHash = commit.treeHash;
    }
  }
  const headFiles = await loadTreeFiles(storage, treeHash);
  return diffFileMaps(headFiles, workingFiles);
}
