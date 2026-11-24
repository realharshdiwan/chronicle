import type { BlobObject, CommitObject, TreeObject } from '../types';

const encoder = new TextEncoder();

/**
 * Deterministic canonical JSON serialization with lexicographically sorted keys.
 * Guarantees identical hashes for structurally identical objects regardless of key insertion order.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalStringify(item)).join(',') + ']';
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();

  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`
  );
  return `{${parts.join(',')}}`;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = encoder.encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export async function createBlobObject(content: string): Promise<BlobObject> {
  const byteLength = encoder.encode(content).byteLength;
  const hash = await sha256Hex(
    canonicalStringify({
      type: 'blob',
      content,
    })
  );
  return {
    type: 'blob',
    hash,
    content,
    byteLength,
  };
}

export async function createTreeObject(
  entries: Record<string, string>
): Promise<TreeObject> {
  const sortedEntries: Record<string, string> = {};
  for (const key of Object.keys(entries).sort()) {
    sortedEntries[key] = entries[key];
  }
  const hash = await sha256Hex(
    canonicalStringify({
      type: 'tree',
      entries: sortedEntries,
    })
  );
  return {
    type: 'tree',
    hash,
    entries: sortedEntries,
  };
}

export async function createCommitObject(params: {
  treeHash: string;
  parentHashes: string[];
  message: string;
  author: string;
  timestamp: number;
}): Promise<CommitObject> {
  const payload = {
    type: 'commit' as const,
    treeHash: params.treeHash,
    parentHashes: [...params.parentHashes],
    message: params.message,
    author: params.author,
    timestamp: params.timestamp,
  };
  const hash = await sha256Hex(canonicalStringify(payload));
  return {
    ...payload,
    hash,
  };
}
