/**
 * File-scoped undo.
 *
 * A `Y.UndoManager` is created for exactly one `Y.Text`. Only local editor
 * transactions are tracked, so remote BroadcastChannel updates, IndexedDB
 * replays, and atomic checkout/merge hydration are never undoable. The undo
 * stack is also cleared whenever a `"checkout"` transaction arrives, which
 * prevents a stale local edit from being replayed after a branch switch.
 */

import { UndoManager } from "yjs";
import type { Doc, Text as YText } from "yjs";

import { CHECKOUT_ORIGIN } from "./WorkingTreeDoc";

/** Origin used by editor keystrokes and `WorkingTreeDoc.setFile`. */
export const LOCAL_EDIT_ORIGIN = "local";

export class FileUndoManager {
  readonly manager: UndoManager;

  private readonly doc: Doc;
  private readonly onUpdate: (update: Uint8Array, origin: unknown) => void;

  constructor(doc: Doc, text: YText) {
    this.doc = doc;
    this.manager = new UndoManager(text, {
      trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
    });

    this.onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin === CHECKOUT_ORIGIN) this.manager.clear();
    };
    this.doc.on("update", this.onUpdate);
  }

  get canUndo(): boolean {
    return this.manager.canUndo();
  }

  get canRedo(): boolean {
    return this.manager.canRedo();
  }

  undo(): void {
    this.manager.undo();
  }

  redo(): void {
    this.manager.redo();
  }

  clear(): void {
    this.manager.clear();
  }

  destroy(): void {
    this.doc.off("update", this.onUpdate);
    this.manager.destroy();
  }
}
