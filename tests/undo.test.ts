import { describe, expect, it } from "vitest";

import { WorkingTreeDoc } from "../src/core/crdt/WorkingTreeDoc";
import { FileUndoManager, LOCAL_EDIT_ORIGIN } from "../src/core/crdt/undo";
import { BROADCAST_ORIGIN } from "../src/core/crdt/TabSyncBridge";

describe("FileUndoManager", () => {
  it("undoes only edits to its own Y.Text", async () => {
    const tree = new WorkingTreeDoc({ persist: false });
    tree.hydrateFromTree({ "a.md": "alpha\n", "b.md": "beta\n" });

    const textA = tree.getText("a.md");
    expect(textA).not.toBeNull();
    if (!textA) return;

    const undo = new FileUndoManager(tree.doc, textA);

    tree.setFile("a.md", "alpha edited\n");
    expect(undo.canUndo).toBe(true);

    tree.setFile("b.md", "beta edited\n");
    undo.undo();

    expect(tree.readFiles()).toEqual({
      "a.md": "alpha\n",
      "b.md": "beta edited\n",
    });

    undo.destroy();
    await tree.destroy();
  });

  it("ignores remote and checkout origins", async () => {
    const tree = new WorkingTreeDoc({ persist: false });
    tree.hydrateFromTree({ "a.md": "alpha\n" });

    const text = tree.getText("a.md");
    expect(text).not.toBeNull();
    if (!text) return;

    const undo = new FileUndoManager(tree.doc, text);

    tree.setFile("a.md", "from another tab\n", BROADCAST_ORIGIN);
    expect(undo.canUndo).toBe(false);

    tree.setFile("a.md", "checkout snapshot\n", "checkout");
    expect(undo.canUndo).toBe(false);

    undo.destroy();
    await tree.destroy();
  });

  it("clears its stack when a checkout transaction arrives", async () => {
    const tree = new WorkingTreeDoc({ persist: false });
    tree.hydrateFromTree({ "a.md": "alpha\n" });

    const text = tree.getText("a.md");
    expect(text).not.toBeNull();
    if (!text) return;

    const undo = new FileUndoManager(tree.doc, text);

    tree.setFile("a.md", "uncommitted edit\n");
    expect(undo.canUndo).toBe(true);

    // Atomically replace the whole tree, as Repository.checkout does.
    tree.hydrateFromTree({ "a.md": "committed snapshot\n", "b.md": "new\n" });

    expect(undo.canUndo).toBe(false);
    expect(undo.canRedo).toBe(false);

    undo.destroy();
    await tree.destroy();
  });

  it("starts with an empty stack for a newly opened file", async () => {
    const tree = new WorkingTreeDoc({ persist: false });
    tree.hydrateFromTree({ "a.md": "alpha\n", "b.md": "beta\n" });

    const textA = tree.getText("a.md");
    const textB = tree.getText("b.md");
    expect(textA).not.toBeNull();
    expect(textB).not.toBeNull();
    if (!textA || !textB) return;

    const undoA = new FileUndoManager(tree.doc, textA);
    tree.setFile("a.md", "alpha edited\n");
    tree.setFile("b.md", "beta edited\n");
    expect(undoA.canUndo).toBe(true);

    // Switching files destroys the old manager and creates a fresh scope.
    undoA.destroy();
    const undoB = new FileUndoManager(tree.doc, textB);
    expect(undoB.canUndo).toBe(false);
    expect(undoB.canRedo).toBe(false);

    // The B-scoped manager cannot replay A's history.
    undoB.undo();
    expect(tree.readFiles()["a.md"]).toBe("alpha edited\n");

    undoB.destroy();
    await tree.destroy();
  });

  it("tracks local-origin edits and supports redo", async () => {
    const tree = new WorkingTreeDoc({ persist: false });
    tree.hydrateFromTree({ "a.md": "alpha\n" });

    const text = tree.getText("a.md");
    expect(text).not.toBeNull();
    if (!text) return;

    const undo = new FileUndoManager(tree.doc, text);

    tree.doc.transact(() => {
      text.insert(text.length, "local line\n");
    }, LOCAL_EDIT_ORIGIN);

    expect(text.toString()).toBe("alpha\nlocal line\n");
    expect(undo.canUndo).toBe(true);

    undo.undo();
    expect(text.toString()).toBe("alpha\n");
    expect(undo.canRedo).toBe(true);

    undo.redo();
    expect(text.toString()).toBe("alpha\nlocal line\n");

    undo.destroy();
    await tree.destroy();
  });
});
