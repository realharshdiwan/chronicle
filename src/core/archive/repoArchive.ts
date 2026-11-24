import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  createBlobObject,
  createCommitObject,
  createTreeObject,
} from '../cas/hash';
import type { IObjectStorage } from '../cas/ObjectStore';
import { isSafeRepoPath } from '../share/shareLink';
import type { CASObject, RefState } from '../types';

export const ARCHIVE_FORMAT = 'chronicle-archive';
export const ARCHIVE_BUNDLE_ZIP_PATH = '.chronicle/repository.json';
export const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024; // 25 MB safety limit for local browser parsing

export interface ChronicleArchiveV1 {
  format: 'chronicle-archive';
  version: 1;
  exportedAt: string;
  workspaceName: string;
  refs: RefState;
  objects: CASObject[];
  workingTreeFiles: Record<string, string>;
  activeFile: string | null;
}

export type ImportedDropResult =
  | {
      kind: 'archive';
      archive: ChronicleArchiveV1;
    }
  | {
      kind: 'files';
      files: Record<string, string>;
      skippedCount: number;
    };

async function verifyCASObject(obj: CASObject): Promise<boolean> {
  if (!obj || typeof obj !== 'object' || typeof obj.hash !== 'string') {
    return false;
  }
  if (obj.type === 'blob') {
    if (typeof obj.content !== 'string') return false;
    const expected = await createBlobObject(obj.content);
    return expected.hash === obj.hash && expected.byteLength === obj.byteLength;
  }
  if (obj.type === 'tree') {
    if (!obj.entries || typeof obj.entries !== 'object') return false;
    for (const p of Object.keys(obj.entries)) {
      if (!isSafeRepoPath(p) || typeof obj.entries[p] !== 'string') {
        return false;
      }
    }
    const expected = await createTreeObject(obj.entries);
    return expected.hash === obj.hash;
  }
  if (obj.type === 'commit') {
    if (
      typeof obj.treeHash !== 'string' ||
      !Array.isArray(obj.parentHashes) ||
      typeof obj.message !== 'string' ||
      typeof obj.author !== 'string' ||
      typeof obj.timestamp !== 'number'
    ) {
      return false;
    }
    const expected = await createCommitObject({
      treeHash: obj.treeHash,
      parentHashes: obj.parentHashes,
      message: obj.message,
      author: obj.author,
      timestamp: obj.timestamp,
    });
    return expected.hash === obj.hash;
  }
  return false;
}

export async function buildRepoArchive(params: {
  storage: IObjectStorage;
  refs: RefState;
  workingTreeFiles: Record<string, string>;
  activeFile: string | null;
  workspaceName: string;
}): Promise<ChronicleArchiveV1> {
  const objects = await params.storage.getAllObjects();
  const sortedFiles: Record<string, string> = {};
  for (const key of Object.keys(params.workingTreeFiles).sort()) {
    if (isSafeRepoPath(key)) {
      sortedFiles[key] = params.workingTreeFiles[key];
    }
  }
  return {
    format: ARCHIVE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    workspaceName: params.workspaceName.trim() || 'Chronicle Workspace',
    refs: params.refs,
    objects,
    workingTreeFiles: sortedFiles,
    activeFile:
      params.activeFile && sortedFiles[params.activeFile] !== undefined
        ? params.activeFile
        : Object.keys(sortedFiles)[0] ?? null,
  };
}

export function serializeRepoArchiveJSON(archive: ChronicleArchiveV1): string {
  return JSON.stringify(archive, null, 2);
}

/**
 * Generates a portable .zip containing all working tree files at their relative paths
 * plus `.chronicle/repository.json` with the full verifiable Merkle-DAG history.
 */
export function buildRepoZipBytes(archive: ChronicleArchiveV1): Uint8Array {
  const zipEntries: Record<string, Uint8Array> = {};
  for (const [filePath, content] of Object.entries(archive.workingTreeFiles)) {
    if (isSafeRepoPath(filePath)) {
      zipEntries[filePath] = strToU8(content);
    }
  }
  zipEntries[ARCHIVE_BUNDLE_ZIP_PATH] = strToU8(
    serializeRepoArchiveJSON(archive)
  );
  return zipSync(zipEntries, { level: 6 });
}

export async function parseAndVerifyRepoArchiveJSON(
  rawJson: string
): Promise<ChronicleArchiveV1> {
  if (rawJson.length > MAX_ARCHIVE_BYTES) {
    throw new Error('Archive exceeds maximum supported size (25 MB).');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid JSON archive.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Archive payload must be a JSON object.');
  }

  const candidate = parsed as Partial<ChronicleArchiveV1>;
  if (candidate.format !== ARCHIVE_FORMAT || candidate.version !== 1) {
    throw new Error('Unrecognized archive format (expected chronicle-archive v1).');
  }

  if (
    !candidate.refs ||
    !candidate.refs.head ||
    !candidate.refs.branches ||
    !Array.isArray(candidate.objects) ||
    !candidate.workingTreeFiles ||
    typeof candidate.workingTreeFiles !== 'object'
  ) {
    throw new Error('Archive payload is missing required repository fields.');
  }

  const verifiedIds = new Set<string>();
  for (const obj of candidate.objects) {
    const ok = await verifyCASObject(obj);
    if (!ok) {
      throw new Error(
        `Archive failed SHA-256 verification for object ${String(
          (obj as { hash?: string })?.hash ?? 'unknown'
        ).slice(0, 12)}.`
      );
    }
    verifiedIds.add(obj.hash);
  }

  for (const [branch, hash] of Object.entries(candidate.refs.branches)) {
    if (!branch || typeof hash !== 'string' || !verifiedIds.has(hash)) {
      throw new Error(`Archive branch "${branch}" points to missing commit.`);
    }
  }

  if (candidate.refs.head.type === 'branch') {
    if (!candidate.refs.branches[candidate.refs.head.branch]) {
      throw new Error('Archive HEAD references an unknown branch.');
    }
  } else if (candidate.refs.head.type === 'detached') {
    if (!verifiedIds.has(candidate.refs.head.commitHash)) {
      throw new Error('Archive detached HEAD references missing commit.');
    }
  } else {
    throw new Error('Archive has invalid HEAD ref.');
  }

  const cleanFiles: Record<string, string> = {};
  for (const [path, content] of Object.entries(candidate.workingTreeFiles)) {
    if (!isSafeRepoPath(path) || typeof content !== 'string') {
      throw new Error(`Archive contains unsafe or invalid path "${path}".`);
    }
    cleanFiles[path] = content;
  }

  return {
    format: ARCHIVE_FORMAT,
    version: 1,
    exportedAt:
      typeof candidate.exportedAt === 'string'
        ? candidate.exportedAt
        : new Date().toISOString(),
    workspaceName:
      typeof candidate.workspaceName === 'string' &&
      candidate.workspaceName.trim()
        ? candidate.workspaceName.trim()
        : 'Imported Workspace',
    refs: candidate.refs,
    objects: candidate.objects,
    workingTreeFiles: cleanFiles,
    activeFile:
      typeof candidate.activeFile === 'string' &&
      cleanFiles[candidate.activeFile] !== undefined
        ? candidate.activeFile
        : Object.keys(cleanFiles)[0] ?? null,
  };
}

function isLikelyTextBytes(bytes: Uint8Array): boolean {
  const sampleLen = Math.min(bytes.byteLength, 2048);
  for (let i = 0; i < sampleLen; i++) {
    if (bytes[i] === 0) return false;
  }
  return true;
}

function normalizeImportedPath(rawPath: string): string | null {
  const cleaned = rawPath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '');
  if (!cleaned) return null;
  const segments = cleaned.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (
    segments.some(
      (s) =>
        s === '.git' ||
        s === 'node_modules' ||
        s === '.DS_Store' ||
        s === '__MACOSX' ||
        s === '.chronicle'
    )
  ) {
    return null;
  }
  const joined = segments.join('/');
  return isSafeRepoPath(joined) ? joined : null;
}

function stripCommonTopFolder(paths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  const firstSegments = paths.map((p) => p.split('/')[0]);
  const allMultiSegment = paths.every((p) => p.includes('/'));
  const sharedRoot =
    allMultiSegment && firstSegments.every((s) => s === firstSegments[0])
      ? firstSegments[0]
      : null;
  for (const p of paths) {
    map.set(
      p,
      sharedRoot ? p.slice(sharedRoot.length + 1) : p
    );
  }
  return map;
}

/**
 * Interprets uploaded or drag-and-dropped files (.json archive, .zip archive, or plain Markdown/text files/folders).
 */
export async function importFromUploadedFiles(
  inputs: Array<{ path: string; bytes: Uint8Array }>
): Promise<ImportedDropResult> {
  if (inputs.length === 0) {
    throw new Error('No files provided for import.');
  }

  // 1. Single .json file -> attempt verified ChronicleArchiveV1 parse
  if (inputs.length === 1 && inputs[0].path.toLowerCase().endsWith('.json')) {
    const raw = strFromU8(inputs[0].bytes);
    const parsedObj = JSON.parse(raw) as { format?: string };
    if (parsedObj && parsedObj.format === ARCHIVE_FORMAT) {
      const archive = await parseAndVerifyRepoArchiveJSON(raw);
      return { kind: 'archive', archive };
    }
  }

  // 2. Single .zip file -> check for `.chronicle/repository.json` or extract text files
  if (inputs.length === 1 && inputs[0].path.toLowerCase().endsWith('.zip')) {
    if (inputs[0].bytes.byteLength > MAX_ARCHIVE_BYTES) {
      throw new Error('ZIP archive exceeds 25 MB limit.');
    }
    const entries = unzipSync(inputs[0].bytes);
    const bundleBytes = entries[ARCHIVE_BUNDLE_ZIP_PATH];
    if (bundleBytes) {
      const archive = await parseAndVerifyRepoArchiveJSON(strFromU8(bundleBytes));
      return { kind: 'archive', archive };
    }

    const rawCandidates: Array<{ path: string; bytes: Uint8Array }> = [];
    let skippedCount = 0;
    for (const [entryPath, bytes] of Object.entries(entries)) {
      if (entryPath.endsWith('/')) continue;
      const normalized = normalizeImportedPath(entryPath);
      if (!normalized || !isLikelyTextBytes(bytes)) {
        skippedCount++;
        continue;
      }
      rawCandidates.push({ path: normalized, bytes });
    }

    const stripped = stripCommonTopFolder(rawCandidates.map((c) => c.path));
    const files: Record<string, string> = {};
    for (const item of rawCandidates) {
      const finalPath = stripped.get(item.path) ?? item.path;
      if (isSafeRepoPath(finalPath)) {
        files[finalPath] = strFromU8(item.bytes);
      } else {
        skippedCount++;
      }
    }

    if (Object.keys(files).length === 0) {
      throw new Error('No readable Markdown or text files found inside ZIP.');
    }
    return { kind: 'files', files, skippedCount };
  }

  // 3. Individual or dropped folder Markdown / text files
  const validItems: Array<{ path: string; bytes: Uint8Array }> = [];
  let skippedCount = 0;

  for (const item of inputs) {
    const normalized = normalizeImportedPath(item.path);
    if (!normalized || !isLikelyTextBytes(item.bytes)) {
      skippedCount++;
      continue;
    }
    validItems.push({ path: normalized, bytes: item.bytes });
  }

  const stripped = stripCommonTopFolder(validItems.map((i) => i.path));
  const files: Record<string, string> = {};
  for (const item of validItems) {
    const finalPath = stripped.get(item.path) ?? item.path;
    if (isSafeRepoPath(finalPath)) {
      files[finalPath] = strFromU8(item.bytes);
    } else {
      skippedCount++;
    }
  }

  if (Object.keys(files).length === 0) {
    throw new Error('No valid text or Markdown files found to import.');
  }

  return { kind: 'files', files, skippedCount };
}
