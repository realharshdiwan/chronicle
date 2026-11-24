/**
 * CRDT-backed working tree.
 *
 * One `Y.Map<Y.Text>` ("files") holds every open document. `y-indexeddb`
 * persists the Y.Doc incrementally, and `TabSyncBridge` relays binary updates
 * between tabs. Whole-tree replacements (checkout, merge, reset, abort) run in
 * a single `ydoc.transact(..., "checkout")` so editors observe one atomic
 * change instead of N independent file mutations.
 */

import { IndexeddbPersistence } from "y-indexeddb";
import { Doc, Map as YMap, Text as YText } from "yjs";

import type { IWorkingTree } from "../vcs/Repository";

/** Transaction origin used for whole working-tree replacements. */
export const CHECKOUT_ORIGIN = "checkout";

/** Default database name for the live working tree. */
export const DEFAULT_PERSISTENCE_NAME = "chronicle-working-tree";

export interface WorkingTreeDocOptions {
  /** Disable y-indexeddb persistence (tests and ephemeral documents). */
  persist?: boolean;
  /** IndexedDB database name used by y-indexeddb. */
  persistenceName?: string;
  /** Reuse an existing Y.Doc instead of creating one. */
  yDoc?: Doc;
}

export class WorkingTreeDoc implements IWorkingTree {
  readonly doc: Doc;
  readonly files: YMap<YText>;
  readonly persistence: IndexeddbPersistence | null;

  constructor(options: WorkingTreeDocOptions = {}) {
    this.doc = options.yDoc ?? new Doc();
    this.files = this.doc.getMap<YText>("files");

    this.persistence =
      (options.persist ?? true)
        ? new IndexeddbPersistence(
            options.persistenceName ?? DEFAULT_PERSISTENCE_NAME,
            this.doc,
          )
        : null;
  }

  /** Resolves once y-indexeddb has replayed its stored updates. */
  get whenSynced(): Promise<void> {
    return this.persistence
      ? this.persistence.whenSynced.then(() => undefined)
      : Promise.resolve();
  }

  /** Materializes the Y.Map as a sorted plain file map. */
  readFiles(): Record<string, string> {
    const files: Record<string, string> = {};

    for (const path of [...this.files.keys()].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    )) {
      const text = this.files.get(path);
      if (text) files[path] = text.toString();
    }

    return files;
  }

  /** The live Y.Text for a file, for CodeMirror bindings. */
  getText(path: string): YText | null {
    return this.files.get(path) ?? null;
  }

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  /** Replaces one file inside a single transaction. */
  setFile(path: string, content: string, origin: unknown = "local"): void {
    this.doc.transact(() => {
      this.replaceText(this.ensureText(path), content);
    }, origin);
  }

  /** Deletes one file inside a single transaction. */
  deleteFile(path: string, origin: unknown = "local"): void {
    if (!this.files.has(path)) return;
    this.doc.transact(() => {
      this.files.delete(path);
    }, origin);
  }

  /**
   * Atomically replaces the complete working tree with a committed snapshot.
   *
   * Unchanged files keep their existing Y.Text (no spurious update), deleted
   * files are removed, and new or modified files are updated. Everything runs
   * in one `"checkout"` transaction so the editor and the sync bridge see a
   * single update event.
   */
  hydrateFromTree(files: Readonly<Record<string, string>>): void {
    const entries = Object.entries(files).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    const nextPaths = new Set(entries.map(([path]) => path));

    this.doc.transact(() => {
      for (const path of [...this.files.keys()]) {
        if (!nextPaths.has(path)) this.files.delete(path);
      }

      for (const [path, content] of entries) {
        this.replaceText(this.ensureText(path), content);
      }
    }, CHECKOUT_ORIGIN);
  }

  /** Flushes persistence handles and destroys the Y.Doc. */
  async destroy(): Promise<void> {
    if (this.persistence) await this.persistence.destroy();
    this.doc.destroy();
  }

  private ensureText(path: string): YText {
    const existing = this.files.get(path);
    if (existing) return existing;

    const text = new YText();
    this.files.set(path, text);
    return text;
  }

  private replaceText(text: YText, content: string): void {
    if (text.toString() === content) return;

    if (text.length > 0) text.delete(0, text.length);
    if (content !== "") text.insert(0, content);
  }
}
