import type { CASObject, RefState } from '../types';

export interface IObjectStorage {
  getObject(hash: string): Promise<CASObject | null>;
  hasObject(hash: string): Promise<boolean>;
  putObject(obj: CASObject): Promise<void>;
  writeBatch(objects: CASObject[], refUpdate?: RefState): Promise<number>;
  getAllObjects(): Promise<CASObject[]>;
  getRefs(): Promise<RefState | null>;
  setRefs(refs: RefState): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | null>;
  setMeta<T = unknown>(key: string, value: T): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Pure in-memory write-once CAS storage for unit testing and isolated execution.
 */
export class InMemoryObjectStorage implements IObjectStorage {
  private objects = new Map<string, CASObject>();
  private refs: RefState | null = null;
  private meta = new Map<string, unknown>();

  async getObject(hash: string): Promise<CASObject | null> {
    const obj = this.objects.get(hash);
    return obj ? clone(obj) : null;
  }

  async hasObject(hash: string): Promise<boolean> {
    return this.objects.has(hash);
  }

  async putObject(obj: CASObject): Promise<void> {
    // Write-once invariant: never overwrite an existing hash
    if (!this.objects.has(obj.hash)) {
      this.objects.set(obj.hash, clone(obj));
    }
  }

  async writeBatch(objects: CASObject[], refUpdate?: RefState): Promise<number> {
    const start = performance.now();
    for (const obj of objects) {
      if (!this.objects.has(obj.hash)) {
        this.objects.set(obj.hash, clone(obj));
      }
    }
    if (refUpdate) {
      this.refs = clone(refUpdate);
    }
    return Math.max(0.01, performance.now() - start);
  }

  async getAllObjects(): Promise<CASObject[]> {
    return Array.from(this.objects.values()).map((obj) => clone(obj));
  }

  async getRefs(): Promise<RefState | null> {
    return this.refs ? clone(this.refs) : null;
  }

  async setRefs(refs: RefState): Promise<void> {
    this.refs = clone(refs);
  }

  async getMeta<T = unknown>(key: string): Promise<T | null> {
    if (!this.meta.has(key)) return null;
    return clone(this.meta.get(key) as T);
  }

  async setMeta<T = unknown>(key: string, value: T): Promise<void> {
    this.meta.set(key, clone(value));
  }

  async clear(): Promise<void> {
    this.objects.clear();
    this.refs = null;
    this.meta.clear();
  }

  close(): void {
    // No-op for in-memory storage
  }
}

const DB_NAME = 'chronicle-cas-db';
const DB_VERSION = 1;
const STORE_OBJECTS = 'objects';
const STORE_REFS = 'refs';
const STORE_META = 'meta';
const HEAD_REFS_KEY = 'HEAD_REFS';

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Browser-native IndexedDB CAS storage with write-once object semantics
 * and single-transaction atomic ref updates.
 */
export class IndexedDBObjectStorage implements IObjectStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private dbName: string;

  constructor(dbName: string = DB_NAME) {
    this.dbName = dbName;
  }

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_OBJECTS)) {
          db.createObjectStore(STORE_OBJECTS, { keyPath: 'hash' });
        }
        if (!db.objectStoreNames.contains(STORE_REFS)) {
          db.createObjectStore(STORE_REFS);
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        this.dbPromise = null;
        reject(req.error ?? new Error('Failed to open IndexedDB'));
      };
    });
    return this.dbPromise;
  }

  async getObject(hash: string): Promise<CASObject | null> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_OBJECTS, 'readonly');
    const res = await requestToPromise<CASObject | undefined>(
      tx.objectStore(STORE_OBJECTS).get(hash)
    );
    return res ?? null;
  }

  async hasObject(hash: string): Promise<boolean> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_OBJECTS, 'readonly');
    const key = await requestToPromise(tx.objectStore(STORE_OBJECTS).getKey(hash));
    return key !== undefined;
  }

  async putObject(obj: CASObject): Promise<void> {
    await this.writeBatch([obj]);
  }

  async writeBatch(objects: CASObject[], refUpdate?: RefState): Promise<number> {
    const db = await this.openDB();
    const start = performance.now();
    const stores = refUpdate ? [STORE_OBJECTS, STORE_REFS] : [STORE_OBJECTS];
    const tx = db.transaction(stores, 'readwrite');
    const objectStore = tx.objectStore(STORE_OBJECTS);

    for (const obj of objects) {
      // Check existence first to enforce write-once without triggering ConstraintError aborts
      const checkReq = objectStore.getKey(obj.hash);
      checkReq.onsuccess = () => {
        if (checkReq.result === undefined) {
          objectStore.add(obj);
        }
      };
    }

    if (refUpdate) {
      tx.objectStore(STORE_REFS).put(refUpdate, HEAD_REFS_KEY);
    }

    await transactionDone(tx);
    return Math.max(0.05, performance.now() - start);
  }

  async getAllObjects(): Promise<CASObject[]> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_OBJECTS, 'readonly');
    return await requestToPromise<CASObject[]>(
      tx.objectStore(STORE_OBJECTS).getAll()
    );
  }

  async getRefs(): Promise<RefState | null> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_REFS, 'readonly');
    const res = await requestToPromise<RefState | undefined>(
      tx.objectStore(STORE_REFS).get(HEAD_REFS_KEY)
    );
    return res ?? null;
  }

  async setRefs(refs: RefState): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_REFS, 'readwrite');
    tx.objectStore(STORE_REFS).put(refs, HEAD_REFS_KEY);
    await transactionDone(tx);
  }

  async getMeta<T = unknown>(key: string): Promise<T | null> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_META, 'readonly');
    const res = await requestToPromise<T | undefined>(
      tx.objectStore(STORE_META).get(key)
    );
    return res ?? null;
  }

  async setMeta<T = unknown>(key: string, value: T): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put(value, key);
    await transactionDone(tx);
  }

  async clear(): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction([STORE_OBJECTS, STORE_REFS, STORE_META], 'readwrite');
    tx.objectStore(STORE_OBJECTS).clear();
    tx.objectStore(STORE_REFS).clear();
    tx.objectStore(STORE_META).clear();
    await transactionDone(tx);
  }

  close(): void {
    if (this.dbPromise) {
      this.dbPromise.then((db) => db.close()).catch(() => undefined);
      this.dbPromise = null;
    }
  }
}
