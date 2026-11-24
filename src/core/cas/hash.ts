/**
 * Canonical serialization + native SHA-256 hashing.
 *
 * INVARIANT 1: every object is serialized with recursively sorted object keys
 * before hashing, so logically identical payloads always yield the same hash
 * regardless of JavaScript property insertion order.
 */

import type {
  CommitObject,
  Sha256Hash,
  StoredObject,
  TreeObject,
  BlobObject,
} from "../types";

/** An object payload without its own `hash` field. */
export type HashableObjectPayload =
  | Omit<BlobObject, "hash">
  | Omit<TreeObject, "hash">
  | Omit<CommitObject, "hash">;

export class CanonicalSerializationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalSerializationError";
  }
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const textEncoder = new TextEncoder();

export function isSha256Hash(value: unknown): value is Sha256Hash {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

/**
 * Serializes a JSON-compatible value with lexicographically sorted object keys
 * at every nesting level. Arrays keep their order (it is semantically
 * significant), while object key order never affects the output.
 *
 * Values outside the JSON data model (undefined, functions, symbols, bigint,
 * non-finite numbers, class instances, dates, Maps, Sets) are rejected rather
 * than silently coerced, because silent coercion can alias distinct logical
 * payloads onto the same hash.
 */
export function canonicalStringify(value: unknown): string {
  return serialize(value, new Set<object>());
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalSerializationError(
        `Non-finite number cannot be canonicalized: ${String(value)}`,
      );
    }
    // JSON.stringify(-0) === "0", which is the canonical representation.
    return JSON.stringify(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value !== "object") {
    throw new CanonicalSerializationError(
      `Value of type "${typeof value}" is not JSON-serializable`,
    );
  }

  if (ancestors.has(value)) {
    throw new CanonicalSerializationError(
      "Cannot canonicalize a circular reference",
    );
  }

  if (Array.isArray(value)) {
    ancestors.add(value);
    const items: string[] = [];
    for (const item of value) {
      if (item === undefined) {
        throw new CanonicalSerializationError(
          "Sparse arrays and undefined array items are not allowed",
        );
      }
      items.push(serialize(item, ancestors));
    }
    ancestors.delete(value);
    return `[${items.join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalSerializationError(
      "Only plain objects and arrays can be canonicalized",
    );
  }

  const record = value as Record<string, unknown>;
  ancestors.add(value);

  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const item = record[key];
    if (item === undefined) {
      throw new CanonicalSerializationError(
        `Undefined value at key ${JSON.stringify(key)} is not allowed`,
      );
    }
    parts.push(`${JSON.stringify(key)}:${serialize(item, ancestors)}`);
  }

  ancestors.delete(value);
  return `{${parts.join(",")}}`;
}

/** UTF-8 byte length, matching how the content is stored and hashed. */
export function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Native Web Crypto SHA-256, returned as lowercase hex. */
export async function sha256Hex(
  input: string | Uint8Array,
): Promise<Sha256Hash> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "Web Crypto (crypto.subtle) is unavailable. Chronicle requires a secure context or a runtime with Web Crypto support.",
    );
  }

  const bytes = typeof input === "string" ? textEncoder.encode(input) : input;
  const digest = await subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return bytesToHex(new Uint8Array(digest));
}

/** Strips the address field from a stored object to obtain its hashed payload. */
export function toHashablePayload(object: StoredObject): HashableObjectPayload {
  switch (object.type) {
    case "blob":
      return {
        type: "blob",
        content: object.content,
        byteLength: object.byteLength,
      };
    case "tree":
      return { type: "tree", entries: { ...object.entries } };
    case "commit":
      return {
        type: "commit",
        treeHash: object.treeHash,
        parentHashes: [...object.parentHashes],
        message: object.message,
        author: object.author,
        timestamp: object.timestamp,
      };
  }
}

/** Hashes a canonicalized object payload; the result is the object's address. */
export async function hashObjectPayload(
  payload: HashableObjectPayload,
): Promise<Sha256Hash> {
  return sha256Hex(canonicalStringify(payload));
}
