/**
 * Content-addressable object storage.
 *
 * INVARIANT 2: objects are write-once and never overwritten. Only RefState
 * (HEAD + branch pointers) mutates, and ref writes happen atomically.
 *
 * INVARIANT 3: this module and everything else under src/core/ is pure
 * TypeScript. Browser storage is accessed only through IObjectStorage;
 * IndexedDBObjectStorage is the production adapter and InMemoryObjectStorage
 * is the fast Vitest adapter.
 */

import type { RefState, Sha256Hash, StoredObject } from "../types";
import {
  canonicalStringify,
  hashObjectPayload,
  isSha256Hash,
  toHashablePayload,
  utf8ByteLength,
} from "./hash";

export class ObjectStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObjectStoreError";
  }
}

/** An object's address does not match its canonical payload, or it is malformed. */
export class ObjectIntegrityError extends ObjectStoreError {
  constructor(message: string) {
    super(message);
    this.name = "ObjectIntegrityError";
  }
}

export class InvalidRefStateError extends ObjectStoreError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRefStateError";
  }
}

export interface StorageWriteBatch {
  objects?: readonly StoredObject[];
  /** When present, replaces the singleton RefState atomically with the objects. */
  refs?: RefState;
}

export interface IObjectStorage {
  readonly kind: "memory" | "indexeddb";

  getObject(hash: Sha256Hash): Promise<StoredObject | undefined>;
  getObjects(hashes: readonly Sha256Hash[]): Promise<Map<Sha256Hash, StoredObject>>;
  listObjects(): Promise<StoredObject[]>;
  hasObject(hash: Sha256Hash): Promise<boolean>;

  putObject(object: StoredObject): Promise<void>;
  putObjects(objects: readonly StoredObject[]): Promise<void>;

  getRefs(): Promise<RefState | null>;
  updateRefs(updater: (current: RefState | null) => RefState): Promise<RefState>;

  /**
   * Writes objects and/or refs in one atomic unit. On IndexedDB this is a
   * single readwrite transaction spanning both object stores.
   */
  writeBatch(batch: StorageWriteBatch): Promise<void>;

  /** Removes every object and the singleton ref state. Intended for tests/reset. */
  clear(): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_DB_NAME = "chronicle-cas";
const DB_VERSION = 1;
const OBJECTS_STORE = "objects";
const REFS_STORE = "refs";
const REFS_KEY = "current";

/**
 * Serializes writes issued from the same JS context so concurrent
 * read-modify-write ref updates cannot lose one another. Cross-tab atomicity
 * is provided separately by IndexedDB's readwrite transaction isolation.
 */
class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function describeHash(hash: string): string {
  return `${hash.slice(0, 12)}…`;
}

/**
 * Validates structure, then re-derives the address from the canonical payload.
 * This catches tampered objects before they can enter the store.
 */
async function validateObject(object: StoredObject): Promise<void> {
  if (!isSha256Hash(object.hash)) {
    throw new ObjectIntegrityError(
      `Object hash must be 64 lowercase hex characters, received "${String(object.hash)}"`,
    );
  }

  switch (object.type) {
    case "blob": {
      const actualByteLength = utf8ByteLength(object.content);
      if (object.byteLength !== actualByteLength) {
        throw new ObjectIntegrityError(
          `Blob ${describeHash(object.hash)} declares ${object.byteLength} bytes but its content is ${actualByteLength} bytes`,
        );
      }
      break;
    }
    case "tree": {
      for (const [path, blobHash] of Object.entries(object.entries)) {
        if (path.trim() === "") {
          throw new ObjectIntegrityError(
            `Tree ${describeHash(object.hash)} contains an empty file path`,
          );
        }
        if (!isSha256Hash(blobHash)) {
          throw new ObjectIntegrityError(
            `Tree ${describeHash(object.hash)} entry ${JSON.stringify(path)} has an invalid blob hash`,
          );
        }
      }
      break;
    }
    case "commit": {
      if (!isSha256Hash(object.treeHash)) {
        throw new ObjectIntegrityError(
          `Commit ${describeHash(object.hash)} has an invalid tree hash`,
        );
      }
      if (
        !Array.isArray(object.parentHashes) ||
        !object.parentHashes.every(isSha256Hash)
      ) {
        throw new ObjectIntegrityError(
          `Commit ${describeHash(object.hash)} has invalid parent hashes`,
        );
      }
      if (typeof object.message !== "string") {
        throw new ObjectIntegrityError(
          `Commit ${describeHash(object.hash)} has a non-string message`,
        );
      }
      if (typeof object.author !== "string" || object.author.trim() === "") {
        throw new ObjectIntegrityError(
          `Commit ${describeHash(object.hash)} has an empty author`,
        );
      }
      if (!Number.isFinite(object.timestamp)) {
        throw new ObjectIntegrityError(
          `Commit ${describeHash(object.hash)} has a non-finite timestamp`,
        );
      }
      break;
    }
    default: {
      const unknownType = (object as { type?: unknown }).type;
      throw new ObjectIntegrityError(
        `Unknown object type ${JSON.stringify(unknownType)}`,
      );
    }
  }

  const expectedHash = await hashObjectPayload(toHashablePayload(object));
  if (expectedHash !== object.hash) {
    throw new ObjectIntegrityError(
      `Object integrity failure: ${object.type} ${describeHash(object.hash)} does not match its canonical payload (expected ${describeHash(expectedHash)})`,
    );
  }
}

function assertSamePayload(
  existing: StoredObject,
  incoming: StoredObject,
): void {
  const existingJson = canonicalStringify(toHashablePayload(existing));
  const incomingJson = canonicalStringify(toHashablePayload(incoming));
  if (existingJson !== incomingJson) {
    throw new ObjectIntegrityError(
      `Refusing to overwrite immutable ${existing.type} ${describeHash(existing.hash)} with different content`,
    );
  }
}

/** Deduplicates a batch by address and verifies every distinct object. */
async function prepareObjects(
  objects: readonly StoredObject[],
): Promise<StoredObject[]> {
  const unique = new Map<Sha256Hash, StoredObject>();

  for (const object of objects) {
    const existing = unique.get(object.hash);
    if (existing) {
      assertSamePayload(existing, object);
      continue;
    }
    unique.set(object.hash, object);
  }

  const prepared = [...unique.values()];
  await Promise.all(prepared.map(validateObject));
  return prepared;
}

export function assertValidRefState(refs: RefState): void {
  if (refs === null || typeof refs !== "object") {
    throw new InvalidRefStateError("RefState must be an object");
  }

  const { head, branches } = refs;
  if (branches === null || typeof branches !== "object" || Array.isArray(branches)) {
    throw new InvalidRefStateError("RefState.branches must be an object");
  }

  for (const [name, commitHash] of Object.entries(branches)) {
    if (name.trim() === "") {
      throw new InvalidRefStateError("Branch names must be non-empty");
    }
    if (!isSha256Hash(commitHash)) {
      throw new InvalidRefStateError(
        `Branch ${JSON.stringify(name)} points to an invalid commit hash`,
      );
    }
  }

  if (head?.type === "branch") {
    if (typeof head.name !== "string" || head.name.trim() === "") {
      throw new InvalidRefStateError("HEAD branch name must be non-empty");
    }
    if (!Object.prototype.hasOwnProperty.call(branches, head.name)) {
      throw new InvalidRefStateError(
        `HEAD points to branch ${JSON.stringify(head.name)}, which does not exist`,
      );
    }
  } else if (head?.type === "detached") {
    if (!isSha256Hash(head.commitHash)) {
      throw new InvalidRefStateError(
        "Detached HEAD must reference a valid commit hash",
      );
    }
  } else {
    throw new InvalidRefStateError(
      "RefState.head must be either a branch or a detached commit",
    );
  }
}

function refsEqual(left: RefState | null, right: RefState): boolean {
  return (
    left !== null &&
    canonicalStringify(left) === canonicalStringify(right)
  );
}

export class InMemoryObjectStorage implements IObjectStorage {
  readonly kind = "memory" as const;

  private readonly objects = new Map<Sha256Hash, StoredObject>();
  private refs: RefState | null = null;
  private readonly queue = new SerialQueue();

  async getObject(hash: Sha256Hash): Promise<StoredObject | undefined> {
    return this.objects.get(hash);
  }

  async getObjects(
    hashes: readonly Sha256Hash[],
  ): Promise<Map<Sha256Hash, StoredObject>> {
    const result = new Map<Sha256Hash, StoredObject>();
    for (const hash of new Set(hashes)) {
      const object = this.objects.get(hash);
      if (object) result.set(hash, object);
    }
    return result;
  }

  async listObjects(): Promise<StoredObject[]> {
    return [...this.objects.values()];
  }

  async hasObject(hash: Sha256Hash): Promise<boolean> {
    return this.objects.has(hash);
  }

  async putObject(object: StoredObject): Promise<void> {
    await this.writeBatch({ objects: [object] });
  }

  async putObjects(objects: readonly StoredObject[]): Promise<void> {
    await this.writeBatch({ objects });
  }

  async getRefs(): Promise<RefState | null> {
    return this.refs === null ? null : structuredClone(this.refs);
  }

  async updateRefs(
    updater: (current: RefState | null) => RefState,
  ): Promise<RefState> {
    return this.queue.run(async () => {
      const current = this.refs === null ? null : structuredClone(this.refs);
      const next = updater(current);
      assertValidRefState(next);

      this.refs = deepFreeze(structuredClone(next));
      return structuredClone(next);
    });
  }

  async writeBatch(batch: StorageWriteBatch): Promise<void> {
    const objects = batch.objects ?? [];

    await this.queue.run(async () => {
      const prepared = await prepareObjects(objects);
      if (batch.refs !== undefined) {
        assertValidRefState(batch.refs);
      }

      for (const object of prepared) {
        const existing = this.objects.get(object.hash);
        if (existing) assertSamePayload(existing, object);
      }

      // From here on there is no await: the batch becomes visible atomically.
      for (const object of prepared) {
        if (!this.objects.has(object.hash)) {
          this.objects.set(object.hash, deepFreeze(structuredClone(object)));
        }
      }

      if (
        batch.refs !== undefined &&
        !refsEqual(this.refs, batch.refs)
      ) {
        this.refs = deepFreeze(structuredClone(batch.refs));
      }
    });
  }

  async clear(): Promise<void> {
    await this.queue.run(async () => {
      this.objects.clear();
      this.refs = null;
    });
  }

  async close(): Promise<void> {
    // Nothing to release for the in-memory adapter.
  }
}

export interface IndexedDBObjectStorageOptions {
  dbName?: string;
  /** Injectable factory for tests; defaults to the global IndexedDB. */
  factory?: IDBFactory;
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new ObjectStoreError("IndexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new ObjectStoreError("IndexedDB transaction aborted"));
  });
}

export class IndexedDBObjectStorage implements IObjectStorage {
  readonly kind = "indexeddb" as const;

  private readonly dbName: string;
  private readonly factory: IDBFactory | undefined;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly queue = new SerialQueue();

  constructor(options: IndexedDBObjectStorageOptions = {}) {
    this.dbName = options.dbName ?? DEFAULT_DB_NAME;
    this.factory = options.factory;
  }

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    const factory = this.factory ?? globalThis.indexedDB;
    if (!factory) {
      return Promise.reject(
        new ObjectStoreError(
          "IndexedDB is unavailable in this environment. Chronicle requires a browser or fake-indexeddb in tests.",
        ),
      );
    }

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OBJECTS_STORE)) {
          db.createObjectStore(OBJECTS_STORE, { keyPath: "hash" });
        }
        if (!db.objectStoreNames.contains(REFS_STORE)) {
          db.createObjectStore(REFS_STORE);
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () =>
        reject(
          request.error ??
            new ObjectStoreError(`Failed to open IndexedDB "${this.dbName}"`),
        );
    });

    return this.dbPromise;
  }

  async getObject(hash: Sha256Hash): Promise<StoredObject | undefined> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, "readonly");
      const request = tx.objectStore(OBJECTS_STORE).get(hash);
      let result: StoredObject | undefined;

      request.onsuccess = () => {
        result = request.result as StoredObject | undefined;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () =>
        reject(tx.error ?? new ObjectStoreError("IndexedDB read failed"));
      tx.onabort = () =>
        reject(tx.error ?? new ObjectStoreError("IndexedDB read aborted"));
    });
  }

  async getObjects(
    hashes: readonly Sha256Hash[],
  ): Promise<Map<Sha256Hash, StoredObject>> {
    const uniqueHashes = [...new Set(hashes)];
    const result = new Map<Sha256Hash, StoredObject>();
    if (uniqueHashes.length === 0) return result;

    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, "readonly");
      const store = tx.objectStore(OBJECTS_STORE);

      for (const hash of uniqueHashes) {
        const request = store.get(hash);
        request.onsuccess = () => {
          const object = request.result as StoredObject | undefined;
          if (object) result.set(hash, object);
        };
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = () =>
        reject(tx.error ?? new ObjectStoreError("IndexedDB read failed"));
      tx.onabort = () =>
        reject(tx.error ?? new ObjectStoreError("IndexedDB read aborted"));
    });
  }

  async listObjects(): Promise<StoredObject[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, "readonly");
      const request = tx.objectStore(OBJECTS_STORE).getAll();
      let result: StoredObject[] = [];

      request.onsuccess = () => {
        result = request.result as StoredObject[];
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () =>
        reject(tx.error ?? new ObjectStoreError("IndexedDB read failed"));
      tx.onabort = () =>
        reject(tx.error ?? new ObjectStoreError("IndexedDB read aborted"));
    });
  }

  async hasObject(hash: Sha256Hash): Promise<boolean> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OBJECTS_STORE, "readonly");
      const request = tx.objectStore(OBJECTS_STORE).count(hash);
      let count = 0;

      request.onsuccess = () => {
        count = request.result;
      };
      tx.oncomplete = () => resolve(count > 0);
      tx.onerror = () =>
        reject(tx.error ?? new ObjectStoreError("IndexedDB read failed"));
      tx.onabort = () =>
        reject(tx.error ?? new ObjectStoreError("IndexedDB read aborted"));
    });
  }

  async putObject(object: StoredObject): Promise<void> {
    await this.writeBatch({ objects: [object] });
  }

  async putObjects(objects: readonly StoredObject[]): Promise<void> {
    await this.writeBatch({ objects });
  }

  async getRefs(): Promise<RefState | null> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(REFS_STORE, "readonly");
      const request = tx.objectStore(REFS_STORE).get(REFS_KEY);
      let result: RefState | null = null;

      request.onsuccess = () => {
        result = (request.result as RefState | undefined) ?? null;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () =>
        reject(tx.error ?? new ObjectStoreError("IndexedDB read failed"));
      tx.onabort = () =>
        reject(tx.error ?? new ObjectStoreError("IndexedDB read aborted"));
    });
  }

  async updateRefs(
    updater: (current: RefState | null) => RefState,
  ): Promise<RefState> {
    return this.queue.run(async () => {
      const db = await this.getDb();

      return new Promise<RefState>((resolve, reject) => {
        const tx = db.transaction(REFS_STORE, "readwrite");
        const store = tx.objectStore(REFS_STORE);
        const getRequest = store.get(REFS_KEY);

        let nextRefs: RefState | null = null;
        let updaterError: unknown;

        getRequest.onsuccess = () => {
          const current =
            (getRequest.result as RefState | undefined) ?? null;
          try {
            nextRefs = updater(current);
            assertValidRefState(nextRefs);
            store.put(nextRefs, REFS_KEY);
          } catch (error) {
            updaterError = error;
            tx.abort();
          }
        };

        tx.oncomplete = () => {
          if (nextRefs === null) {
            reject(new InvalidRefStateError("Ref update produced no state"));
            return;
          }
          resolve(nextRefs);
        };
        tx.onerror = () =>
          reject(
            updaterError ??
              tx.error ??
              new ObjectStoreError("Ref update transaction failed"),
          );
        tx.onabort = () =>
          reject(
            updaterError ??
              tx.error ??
              new ObjectStoreError("Ref update transaction aborted"),
          );
      });
    });
  }

  async writeBatch(batch: StorageWriteBatch): Promise<void> {
    const objects = batch.objects ?? [];

    await this.queue.run(async () => {
      const prepared = await prepareObjects(objects);
      if (batch.refs !== undefined) {
        assertValidRefState(batch.refs);
      }
      if (prepared.length === 0 && batch.refs === undefined) return;

      const db = await this.getDb();
      const storeNames =
        batch.refs === undefined
          ? [OBJECTS_STORE]
          : [OBJECTS_STORE, REFS_STORE];
      const tx = db.transaction(storeNames, "readwrite");
      const objectStore = tx.objectStore(OBJECTS_STORE);

      for (const object of prepared) {
        const request = objectStore.add(object);
        request.onerror = (event) => {
          if (request.error?.name === "ConstraintError") {
            // `add` is the write-once guard. An existing address implies an
            // identical canonical payload (all writes are validated above),
            // so an idempotent duplicate is a safe no-op rather than an
            // overwrite.
            event.preventDefault();
            event.stopPropagation();
          }
        };
      }

      if (batch.refs !== undefined) {
        tx.objectStore(REFS_STORE).put(batch.refs, REFS_KEY);
      }

      await transactionDone(tx);
    });
  }

  async clear(): Promise<void> {
    await this.queue.run(async () => {
      const db = await this.getDb();
      const tx = db.transaction([OBJECTS_STORE, REFS_STORE], "readwrite");
      tx.objectStore(OBJECTS_STORE).clear();
      tx.objectStore(REFS_STORE).clear();
      await transactionDone(tx);
    });
  }

  async close(): Promise<void> {
    const pending = this.dbPromise;
    this.dbPromise = null;
    if (!pending) return;

    const db = await pending.catch(() => null);
    db?.close();
  }
}
