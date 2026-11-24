import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { CHECKOUT_ORIGIN, LOCAL_EDIT_ORIGIN } from './origins';

export interface WorkingTreeDocOptions {
  docName?: string;
  enablePersistence?: boolean;
}

/**
 * Applies minimal prefix/suffix delta to a Y.Text inside an active transaction
 * so CRDT history and cursor positions stay tight.
 */
export function applyTextDelta(yText: Y.Text, nextValue: string): void {
  const prevValue = yText.toString();
  if (prevValue === nextValue) return;

  let start = 0;
  const minLen = Math.min(prevValue.length, nextValue.length);
  while (start < minLen && prevValue.charCodeAt(start) === nextValue.charCodeAt(start)) {
    start++;
  }

  let prevEnd = prevValue.length;
  let nextEnd = nextValue.length;
  while (
    prevEnd > start &&
    nextEnd > start &&
    prevValue.charCodeAt(prevEnd - 1) === nextValue.charCodeAt(nextEnd - 1)
  ) {
    prevEnd--;
    nextEnd--;
  }

  if (prevEnd > start) {
    yText.delete(start, prevEnd - start);
  }
  if (nextEnd > start) {
    yText.insert(start, nextValue.slice(start, nextEnd));
  }
}

export class WorkingTreeDoc {
  readonly doc: Y.Doc;
  readonly filesMap: Y.Map<Y.Text>;
  readonly docName: string;
  private persistence: IndexeddbPersistence | null = null;
  readonly whenSynced: Promise<void>;

  constructor(options: WorkingTreeDocOptions = {}) {
    this.docName = options.docName ?? 'chronicle-working-tree';
    this.doc = new Y.Doc();
    this.filesMap = this.doc.getMap<Y.Text>('files');

    const shouldPersist =
      options.enablePersistence !== false &&
      typeof indexedDB !== 'undefined';

    if (shouldPersist) {
      this.persistence = new IndexeddbPersistence(this.docName, this.doc);
      this.whenSynced = this.persistence.whenSynced.then(() => undefined);
    } else {
      this.whenSynced = Promise.resolve();
    }
  }

  /**
   * Atomically replaces working tree contents from a committed tree snapshot
   * under CHECKOUT_ORIGIN so per-file undo stacks reset cleanly.
   */
  hydrateFromTree(files: Record<string, string>): void {
    this.doc.transact(() => {
      const targetPaths = new Set(Object.keys(files));

      for (const existingPath of Array.from(this.filesMap.keys())) {
        if (!targetPaths.has(existingPath)) {
          this.filesMap.delete(existingPath);
        }
      }

      for (const [path, content] of Object.entries(files)) {
        const existing = this.filesMap.get(path);
        if (existing) {
          applyTextDelta(existing, content);
        } else {
          const yText = new Y.Text();
          yText.insert(0, content);
          this.filesMap.set(path, yText);
        }
      }
    }, CHECKOUT_ORIGIN);
  }

  getFileMap(): Record<string, string> {
    const result: Record<string, string> = {};
    const keys = Array.from(this.filesMap.keys()).sort();
    for (const key of keys) {
      const yText = this.filesMap.get(key);
      if (yText) {
        result[key] = yText.toString();
      }
    }
    return result;
  }

  listFiles(): string[] {
    return Array.from(this.filesMap.keys()).sort();
  }

  getFileText(path: string): Y.Text | undefined {
    return this.filesMap.get(path);
  }

  createFile(path: string, initialContent = ''): Y.Text {
    const trimmed = path.trim().replace(/^\/+/, '');
    if (!trimmed) {
      throw new Error('File path cannot be empty.');
    }
    const existing = this.filesMap.get(trimmed);
    if (existing) {
      throw new Error(`File "${trimmed}" already exists.`);
    }
    let created!: Y.Text;
    this.doc.transact(() => {
      created = new Y.Text();
      if (initialContent) {
        created.insert(0, initialContent);
      }
      this.filesMap.set(trimmed, created);
    }, LOCAL_EDIT_ORIGIN);
    return created;
  }

  deleteFile(path: string): void {
    if (!this.filesMap.has(path)) return;
    this.doc.transact(() => {
      this.filesMap.delete(path);
    }, LOCAL_EDIT_ORIGIN);
  }

  renameFile(oldPath: string, newPath: string): void {
    const source = oldPath.trim().replace(/^\/+/, '');
    const target = newPath.trim().replace(/^\/+/, '');
    if (!source || !target) {
      throw new Error('File path cannot be empty.');
    }
    if (source === target) return;
    if (
      target.includes('\0') ||
      target.includes('\\') ||
      target.split('/').some((seg) => !seg || seg === '.' || seg === '..')
    ) {
      throw new Error(`Invalid target path "${target}".`);
    }
    const existingSource = this.filesMap.get(source);
    if (!existingSource) {
      throw new Error(`File "${source}" does not exist.`);
    }
    if (this.filesMap.has(target)) {
      throw new Error(`File "${target}" already exists.`);
    }

    const content = existingSource.toString();
    this.doc.transact(() => {
      const nextText = new Y.Text();
      if (content) {
        nextText.insert(0, content);
      }
      this.filesMap.set(target, nextText);
      this.filesMap.delete(source);
    }, LOCAL_EDIT_ORIGIN);
  }

  updateFileContent(path: string, nextContent: string, origin = LOCAL_EDIT_ORIGIN): void {
    this.doc.transact(() => {
      let yText = this.filesMap.get(path);
      if (!yText) {
        yText = new Y.Text();
        yText.insert(0, nextContent);
        this.filesMap.set(path, yText);
      } else {
        applyTextDelta(yText, nextContent);
      }
    }, origin);
  }

  onFilesChange(listener: (origin: unknown) => void): () => void {
    const handler = (_events: Y.YEvent<any>[], transaction: Y.Transaction) => {
      listener(transaction.origin);
    };
    this.filesMap.observeDeep(handler);
    return () => {
      this.filesMap.unobserveDeep(handler);
    };
  }

  async clearDocument(): Promise<void> {
    this.doc.transact(() => {
      for (const key of Array.from(this.filesMap.keys())) {
        this.filesMap.delete(key);
      }
    }, CHECKOUT_ORIGIN);

    if (this.persistence) {
      await this.persistence.destroy();
      this.persistence = null;
      if (typeof indexedDB !== 'undefined') {
        await new Promise<void>((resolve) => {
          try {
            const req = indexedDB.deleteDatabase(this.docName);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
          } catch {
            resolve();
          }
        });
      }
    }
  }

  destroy(): void {
    if (this.persistence) {
      this.persistence.destroy();
      this.persistence = null;
    }
    this.doc.destroy();
  }
}
