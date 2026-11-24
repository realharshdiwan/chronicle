import * as Y from 'yjs';
import { CHECKOUT_ORIGIN, LOCAL_EDIT_ORIGIN } from './origins';

/**
 * Per-file Y.UndoManager wrapper that tracks ONLY LOCAL_EDIT_ORIGIN
 * and clears its undo/redo stacks whenever a CHECKOUT_ORIGIN transaction fires.
 */
export class FileUndoManager {
  private undoManagers = new Map<string, Y.UndoManager>();
  private doc: Y.Doc;
  private filesMap: Y.Map<Y.Text>;
  private unbindTx: () => void;

  constructor(doc: Y.Doc, filesMap: Y.Map<Y.Text>) {
    this.doc = doc;
    this.filesMap = filesMap;

    const afterTxHandler = (tx: Y.Transaction) => {
      if (tx.origin === CHECKOUT_ORIGIN) {
        this.clearAll();
      }
    };
    this.doc.on('afterTransaction', afterTxHandler);
    this.unbindTx = () => {
      this.doc.off('afterTransaction', afterTxHandler);
    };
  }

  private getManager(path: string): Y.UndoManager | null {
    const yText = this.filesMap.get(path);
    if (!yText) {
      this.undoManagers.delete(path);
      return null;
    }

    let manager = this.undoManagers.get(path);
    if (!manager) {
      manager = new Y.UndoManager(yText, {
        trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
        captureTimeout: 350,
      });
      this.undoManagers.set(path, manager);
    }
    return manager;
  }

  undo(path: string): boolean {
    const manager = this.getManager(path);
    if (!manager || !manager.canUndo()) return false;
    manager.undo();
    return true;
  }

  redo(path: string): boolean {
    const manager = this.getManager(path);
    if (!manager || !manager.canRedo()) return false;
    manager.redo();
    return true;
  }

  canUndo(path: string): boolean {
    return this.getManager(path)?.canUndo() ?? false;
  }

  canRedo(path: string): boolean {
    return this.getManager(path)?.canRedo() ?? false;
  }

  clearFile(path: string): void {
    const manager = this.undoManagers.get(path);
    if (manager) {
      manager.clear();
    }
  }

  clearAll(): void {
    for (const manager of this.undoManagers.values()) {
      manager.clear();
    }
    this.undoManagers.clear();
  }

  destroy(): void {
    this.unbindTx();
    for (const manager of this.undoManagers.values()) {
      manager.destroy();
    }
    this.undoManagers.clear();
  }
}
