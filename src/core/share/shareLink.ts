import {
  createBlobObject,
  createCommitObject,
  createTreeObject,
} from '../cas/hash';
import type { IObjectStorage } from '../cas/ObjectStore';
import type {
  BlobObject,
  CASObject,
  CommitObject,
  RefState,
  TreeObject,
} from '../types';

export const SHARE_FRAGMENT_PREFIX = 'share=';
export const SHARE_VERSION_PREFIX = 'v1.';
export const MAX_SHARE_FRAGMENT_CHARS = 512 * 1024;
export const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;
export const MAX_SHARE_OBJECTS = 2500;

export interface SharePayloadV1 {
  version: 1;
  createdAt: string;
  refs: RefState;
  objects: CASObject[];
  workingTreeFiles: Record<string, string>;
  activeFile: string | null;
}

export interface ShareSanitizationStats {
  excludedFileCount: number;
  excludedPaths: string[];
  redactedSecretCount: number;
}

export interface GeneratedShareBundle {
  payload: SharePayloadV1;
  fragment: string;
  compressedBytes: number;
  rawBytes: number;
  stats: ShareSanitizationStats;
}

const SENSITIVE_DIR_SEGMENTS = new Set([
  '.secrets',
  '.ssh',
  '.gnupg',
  '.aws',
]);

const PLACEHOLDER_VALUE_RE =
  /^(?:<[^>]+>|your[_-]?.*|my[_-]?.*|example.*|sample.*|changeme|placeholder|redacted|\[redacted(?:_[a-z_]+)?\]|\*+|x+)$/i;

/**
 * Validates that a repository path is a safe relative path without traversal or control bytes.
 */
export function isSafeRepoPath(path: string): boolean {
  if (!path || path.length > 512) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (path.includes('\0') || path.includes('\\')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  const segments = path.split('/');
  return segments.every(
    (seg) => seg.length > 0 && seg !== '.' && seg !== '..'
  );
}

/**
 * Returns true for paths commonly holding secrets, private keys, or credentials.
 */
export function isSensitivePath(path: string): boolean {
  const normalized = path.trim().replace(/^\/+/, '').toLowerCase();
  if (!normalized) return false;
  const segments = normalized.split('/');
  for (let i = 0; i < segments.length - 1; i++) {
    if (SENSITIVE_DIR_SEGMENTS.has(segments[i])) {
      return true;
    }
  }

  const base = segments[segments.length - 1];

  // .env and .env.* (allowing .env.example / .env.template / .env.sample)
  if (/^\.env($|\.(?!example$|template$|sample$))/.test(base)) {
    return true;
  }

  // SSH private keys and credential dotfiles
  if (/^(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/.test(base)) {
    return true;
  }
  if (/^\.(npmrc|netrc|pypirc|git-credentials|htpasswd|dockercfg)$/.test(base)) {
    return true;
  }

  // Private key and certificate store extensions
  if (/\.(pem|key|p12|pfx|jks|keystore)$/.test(base)) {
    return true;
  }

  // Explicit credential / secret filenames
  if (
    /^(credentials|secrets?|service[-_]?account|auth[-_]?secrets?)(\.[^.]+)?$/.test(
      base
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Redacts private keys, provider API tokens, bearer credentials, URL passwords,
 * and common secret variable assignments from text content.
 */
export function redactSensitiveContent(content: string): {
  sanitized: string;
  redactionCount: number;
} {
  let redactionCount = 0;
  let next = content;

  const replaceCount = (
    regex: RegExp,
    replacer: string | ((...args: string[]) => string)
  ) => {
    if (typeof replacer === 'string') {
      next = next.replace(regex, () => {
        redactionCount++;
        return replacer;
      });
    } else {
      next = next.replace(regex, (...args) => replacer(...(args as string[])));
    }
  };

  // 1. Private key PEM blocks
  replaceCount(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]'
  );

  // 2. High-confidence provider API keys & tokens
  replaceCount(/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED_API_KEY]');
  replaceCount(
    /\b(?:sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,})\b/g,
    '[REDACTED_API_KEY]'
  );
  replaceCount(
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    '[REDACTED_TOKEN]'
  );
  replaceCount(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_TOKEN]');
  replaceCount(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');
  replaceCount(
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    '[REDACTED_JWT]'
  );

  // 3. Authorization Bearer tokens
  replaceCount(
    /(\bBearer\s+)([A-Za-z0-9\-._~+/]+=*)/gi,
    (_match, prefix: string, token: string) => {
      if (PLACEHOLDER_VALUE_RE.test(token)) return `${prefix}${token}`;
      redactionCount++;
      return `${prefix}[REDACTED]`;
    }
  );

  // 4. Embedded URL credentials (scheme://user:password@host)
  replaceCount(
    /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi,
    (_match, left: string, secret: string, at: string) => {
      if (PLACEHOLDER_VALUE_RE.test(secret)) return `${left}${secret}${at}`;
      redactionCount++;
      return `${left}[REDACTED]${at}`;
    }
  );

  // 5. Key-value secret assignments (e.g. API_KEY=..., password: "...")
  replaceCount(
    /^([ \t]*(?:export\s+)?['"]?[A-Za-z0-9_-]*(?:API_KEY|SECRET_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|PRIVATE_KEY|CLIENT_SECRET|PASSWORD|SIGNING_KEY|WEBHOOK_SECRET|GEMINI_API_KEY)['"]?\s*[:=]\s*)(['"]?)([^\r\n'"]{6,})\2/gim,
    (_match, prefix: string, quote: string, value: string) => {
      const trimmed = value.trim();
      if (PLACEHOLDER_VALUE_RE.test(trimmed)) {
        return `${prefix}${quote}${value}${quote}`;
      }
      redactionCount++;
      return `${prefix}${quote}[REDACTED]${quote}`;
    }
  );

  return { sanitized: next, redactionCount };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9\-_]+$/.test(encoded)) {
    throw new Error('Invalid characters in shared link payload.');
  }
  const padded =
    encoded.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice((encoded.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function compressBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('Browser compression stream API is unavailable.');
  }
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  const writePromise = writer
    .write(new Uint8Array(input))
    .then(() => writer.close());

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  await writePromise;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function decompressBytes(
  input: Uint8Array,
  maxBytes: number
): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Browser decompression stream API is unavailable.');
  }
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  const writePromise = writer
    .write(new Uint8Array(input))
    .then(() => writer.close())
    .catch(() => undefined);

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        await writer.abort().catch(() => undefined);
        throw new Error(
          `Shared repository exceeds maximum allowed size (${Math.round(maxBytes / (1024 * 1024))} MB).`
        );
      }
      chunks.push(value);
    }
  }
  await writePromise;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Sanitizes CAS history + working tree files (excluding sensitive paths and
 * redacting secret tokens while preserving valid SHA-256 Merkle-DAG hashes)
 * and encodes the repository state into a compressed base64url fragment.
 */
export async function generateShareBundle(params: {
  storage: IObjectStorage;
  refs: RefState;
  workingTreeFiles: Record<string, string>;
  activeFile: string | null;
}): Promise<GeneratedShareBundle> {
  const { storage, refs, workingTreeFiles, activeFile } = params;
  const allObjects = await storage.getAllObjects();

  const objectByHash = new Map<string, CASObject>();
  const commits: CommitObject[] = [];
  for (const obj of allObjects) {
    objectByHash.set(obj.hash, obj);
    if (obj.type === 'commit') {
      commits.push(obj);
    }
  }

  // Topological sort (oldest / root commits first)
  const commitRemainingParents = new Map<string, number>();
  const childrenMap = new Map<string, string[]>();
  for (const c of commits) {
    const validParents = c.parentHashes.filter((p) => objectByHash.has(p));
    commitRemainingParents.set(c.hash, validParents.length);
    for (const p of validParents) {
      const list = childrenMap.get(p) ?? [];
      list.push(c.hash);
      childrenMap.set(p, list);
    }
  }

  const queue: CommitObject[] = commits
    .filter((c) => (commitRemainingParents.get(c.hash) ?? 0) === 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  const topoCommits: CommitObject[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    topoCommits.push(current);
    for (const childHash of childrenMap.get(current.hash) ?? []) {
      const rem = (commitRemainingParents.get(childHash) ?? 1) - 1;
      commitRemainingParents.set(childHash, rem);
      if (rem === 0) {
        const child = objectByHash.get(childHash);
        if (child && child.type === 'commit') {
          queue.push(child);
        }
      }
    }
  }

  const excludedPathsSet = new Set<string>();
  let redactedSecretCount = 0;

  const sanitizedObjects = new Map<string, CASObject>();
  const commitHashRemap = new Map<string, string>();

  for (const commit of topoCommits) {
    const treeObj = objectByHash.get(commit.treeHash);
    if (!treeObj || treeObj.type !== 'tree') continue;

    const nextEntries: Record<string, string> = {};
    let treeModified = false;

    for (const [path, blobHash] of Object.entries(treeObj.entries)) {
      if (!isSafeRepoPath(path) || isSensitivePath(path)) {
        excludedPathsSet.add(path);
        treeModified = true;
        continue;
      }

      const blobObj = objectByHash.get(blobHash);
      if (!blobObj || blobObj.type !== 'blob') continue;

      const { sanitized, redactionCount } = redactSensitiveContent(blobObj.content);
      if (redactionCount > 0) {
        redactedSecretCount += redactionCount;
        treeModified = true;
        const nextBlob = await createBlobObject(sanitized);
        sanitizedObjects.set(nextBlob.hash, nextBlob);
        nextEntries[path] = nextBlob.hash;
      } else {
        sanitizedObjects.set(blobObj.hash, blobObj);
        nextEntries[path] = blobObj.hash;
      }
    }

    const nextTree = treeModified
      ? await createTreeObject(nextEntries)
      : treeObj;
    sanitizedObjects.set(nextTree.hash, nextTree);

    const nextParents = commit.parentHashes.map(
      (p) => commitHashRemap.get(p) ?? p
    );
    const parentsChanged = nextParents.some(
      (p, idx) => p !== commit.parentHashes[idx]
    );

    const nextCommit =
      nextTree.hash !== commit.treeHash || parentsChanged
        ? await createCommitObject({
            treeHash: nextTree.hash,
            parentHashes: nextParents,
            message: commit.message,
            author: commit.author,
            timestamp: commit.timestamp,
          })
        : commit;

    sanitizedObjects.set(nextCommit.hash, nextCommit);
    commitHashRemap.set(commit.hash, nextCommit.hash);
  }

  // Remap refs cleanly
  const nextBranches: Record<string, string> = {};
  for (const [branch, hash] of Object.entries(refs.branches)) {
    nextBranches[branch] = commitHashRemap.get(hash) ?? hash;
  }
  const nextRefs: RefState = {
    head:
      refs.head.type === 'branch'
        ? { type: 'branch', branch: refs.head.branch }
        : {
            type: 'detached',
            commitHash: commitHashRemap.get(refs.head.commitHash) ?? refs.head.commitHash,
          },
    branches: nextBranches,
  };

  // Sanitize working tree files
  const sanitizedWorkingFiles: Record<string, string> = {};
  for (const path of Object.keys(workingTreeFiles).sort()) {
    if (!isSafeRepoPath(path) || isSensitivePath(path)) {
      excludedPathsSet.add(path);
      continue;
    }
    const { sanitized, redactionCount } = redactSensitiveContent(
      workingTreeFiles[path]
    );
    if (redactionCount > 0) {
      redactedSecretCount += redactionCount;
    }
    sanitizedWorkingFiles[path] = sanitized;
  }

  const nextActiveFile =
    activeFile && sanitizedWorkingFiles[activeFile] !== undefined
      ? activeFile
      : Object.keys(sanitizedWorkingFiles)[0] ?? null;

  const payload: SharePayloadV1 = {
    version: 1,
    createdAt: new Date().toISOString(),
    refs: nextRefs,
    objects: Array.from(sanitizedObjects.values()),
    workingTreeFiles: sanitizedWorkingFiles,
    activeFile: nextActiveFile,
  };

  const json = JSON.stringify(payload);
  const rawBytes = new TextEncoder().encode(json);
  const compressed = await compressBytes(rawBytes);
  const encoded = toBase64Url(compressed);
  const fragment = `${SHARE_FRAGMENT_PREFIX}${SHARE_VERSION_PREFIX}${encoded}`;

  return {
    payload,
    fragment,
    compressedBytes: compressed.byteLength,
    rawBytes: rawBytes.byteLength,
    stats: {
      excludedFileCount: excludedPathsSet.size,
      excludedPaths: Array.from(excludedPathsSet).sort(),
      redactedSecretCount,
    },
  };
}

/**
 * Extracts `#share=v1.<base64url>` from a URL hash string, if present.
 */
export function extractShareFragment(hash: string): string | null {
  const cleaned = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!cleaned.startsWith(SHARE_FRAGMENT_PREFIX)) return null;
  const value = cleaned.slice(SHARE_FRAGMENT_PREFIX.length);
  return value.length > 0 ? value : null;
}

/**
 * Decodes, decompresses, schema-validates, and cryptographically verifies
 * an untrusted shared repository fragment.
 */
export async function parseAndVerifySharePayload(
  fragmentOrHash: string
): Promise<SharePayloadV1> {
  const token = fragmentOrHash.startsWith('#') ||
    fragmentOrHash.startsWith(SHARE_FRAGMENT_PREFIX)
    ? extractShareFragment(fragmentOrHash)
    : fragmentOrHash;

  if (!token) {
    throw new Error('No shared workspace payload found in URL fragment.');
  }
  if (token.length > MAX_SHARE_FRAGMENT_CHARS) {
    throw new Error('Shared workspace link exceeds maximum allowed length.');
  }
  if (!token.startsWith(SHARE_VERSION_PREFIX)) {
    throw new Error('Unsupported shared workspace link version.');
  }

  const encoded = token.slice(SHARE_VERSION_PREFIX.length);
  const compressed = fromBase64Url(encoded);
  const rawBytes = await decompressBytes(compressed, MAX_DECOMPRESSED_BYTES);
  const jsonText = new TextDecoder().decode(rawBytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Shared workspace payload contains invalid JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid shared workspace payload.');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error('Unsupported shared workspace schema version.');
  }
  if (!Array.isArray(obj.objects) || obj.objects.length > MAX_SHARE_OBJECTS) {
    throw new Error('Shared workspace contains an invalid or oversized object list.');
  }

  // Validate and cryptographically verify every CAS object
  const verifiedHashes = new Set<string>();
  const verifiedCommits = new Set<string>();
  const verifiedObjects: CASObject[] = [];

  for (const item of obj.objects) {
    if (!item || typeof item !== 'object') {
      throw new Error('Malformed CAS object in shared link.');
    }
    const rec = item as Record<string, unknown>;
    if (rec.type === 'blob') {
      if (typeof rec.hash !== 'string' || typeof rec.content !== 'string') {
        throw new Error('Malformed blob object in shared link.');
      }
      const expected = await createBlobObject(rec.content);
      if (expected.hash !== rec.hash) {
        throw new Error('Shared workspace blob integrity check failed.');
      }
      verifiedHashes.add(expected.hash);
      verifiedObjects.push(expected);
    } else if (rec.type === 'tree') {
      if (
        typeof rec.hash !== 'string' ||
        !rec.entries ||
        typeof rec.entries !== 'object'
      ) {
        throw new Error('Malformed tree object in shared link.');
      }
      const entries: Record<string, string> = {};
      for (const [path, blobHash] of Object.entries(
        rec.entries as Record<string, unknown>
      )) {
        if (!isSafeRepoPath(path) || typeof blobHash !== 'string') {
          throw new Error(`Unsafe or invalid tree path "${path}" in shared link.`);
        }
        entries[path] = blobHash;
      }
      const expected = await createTreeObject(entries);
      if (expected.hash !== rec.hash) {
        throw new Error('Shared workspace tree integrity check failed.');
      }
      verifiedHashes.add(expected.hash);
      verifiedObjects.push(expected);
    } else if (rec.type === 'commit') {
      if (
        typeof rec.hash !== 'string' ||
        typeof rec.treeHash !== 'string' ||
        !Array.isArray(rec.parentHashes) ||
        typeof rec.message !== 'string' ||
        typeof rec.author !== 'string' ||
        typeof rec.timestamp !== 'number'
      ) {
        throw new Error('Malformed commit object in shared link.');
      }
      const parentHashes = rec.parentHashes.filter(
        (p): p is string => typeof p === 'string'
      );
      if (parentHashes.length !== rec.parentHashes.length) {
        throw new Error('Invalid commit parent list in shared link.');
      }
      const expected = await createCommitObject({
        treeHash: rec.treeHash,
        parentHashes,
        message: rec.message,
        author: rec.author,
        timestamp: rec.timestamp,
      });
      if (expected.hash !== rec.hash) {
        throw new Error('Shared workspace commit integrity check failed.');
      }
      verifiedHashes.add(expected.hash);
      verifiedCommits.add(expected.hash);
      verifiedObjects.push(expected);
    } else {
      throw new Error('Unknown CAS object type in shared link.');
    }
  }

  // Validate refs
  if (!obj.refs || typeof obj.refs !== 'object') {
    throw new Error('Missing refs metadata in shared link.');
  }
  const refsRaw = obj.refs as Record<string, unknown>;
  if (!refsRaw.head || typeof refsRaw.head !== 'object') {
    throw new Error('Invalid HEAD ref in shared link.');
  }
  if (!refsRaw.branches || typeof refsRaw.branches !== 'object') {
    throw new Error('Invalid branches map in shared link.');
  }
  const branches: Record<string, string> = {};
  for (const [name, hash] of Object.entries(
    refsRaw.branches as Record<string, unknown>
  )) {
    if (!name.trim() || typeof hash !== 'string' || !verifiedCommits.has(hash)) {
      throw new Error(`Branch "${name}" points to a missing commit in shared link.`);
    }
    branches[name] = hash;
  }

  const headRaw = refsRaw.head as Record<string, unknown>;
  let head: RefState['head'];
  if (headRaw.type === 'branch' && typeof headRaw.branch === 'string') {
    if (!branches[headRaw.branch]) {
      throw new Error('HEAD branch does not exist in shared link.');
    }
    head = { type: 'branch', branch: headRaw.branch };
  } else if (
    headRaw.type === 'detached' &&
    typeof headRaw.commitHash === 'string'
  ) {
    if (!verifiedCommits.has(headRaw.commitHash)) {
      throw new Error('Detached HEAD commit missing in shared link.');
    }
    head = { type: 'detached', commitHash: headRaw.commitHash };
  } else {
    throw new Error('Invalid HEAD target in shared link.');
  }

  // Validate working tree files
  if (!obj.workingTreeFiles || typeof obj.workingTreeFiles !== 'object') {
    throw new Error('Invalid working tree files in shared link.');
  }
  const workingTreeFiles: Record<string, string> = {};
  for (const [path, content] of Object.entries(
    obj.workingTreeFiles as Record<string, unknown>
  )) {
    if (!isSafeRepoPath(path) || isSensitivePath(path)) {
      continue;
    }
    if (typeof content !== 'string') {
      throw new Error(`Invalid file content for "${path}" in shared link.`);
    }
    workingTreeFiles[path] = content;
  }

  const activeFile =
    typeof obj.activeFile === 'string' &&
    workingTreeFiles[obj.activeFile] !== undefined
      ? obj.activeFile
      : Object.keys(workingTreeFiles).sort()[0] ?? null;

  return {
    version: 1,
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    refs: { head, branches },
    objects: verifiedObjects,
    workingTreeFiles,
    activeFile,
  };
}
