import { markdown } from "@codemirror/lang-markdown";
import { Annotation, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import type { Text as YText } from "yjs";

import { FileUndoManager, LOCAL_EDIT_ORIGIN } from "../../core/crdt/undo";
import type { WorkingTreeDoc } from "../../core/crdt/WorkingTreeDoc";

const externalUpdate = Annotation.define<boolean>();

/**
 * Applies the minimal prefix/suffix edit between two snapshots to Y.Text.
 * Ordinary typing becomes a small insert instead of a whole-document replace,
 * which preserves character-level CRDT merging.
 */
function applyTextDiff(text: YText, previous: string, next: string): void {
  if (previous === next) return;

  let start = 0;
  while (
    start < previous.length &&
    start < next.length &&
    previous[start] === next[start]
  ) {
    start += 1;
  }

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previous[previousEnd - 1] === next[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  text.doc?.transact(() => {
    const deleteCount = previousEnd - start;
    if (deleteCount > 0) text.delete(start, deleteCount);
    if (nextEnd > start) text.insert(start, next.slice(start, nextEnd));
  }, LOCAL_EDIT_ORIGIN);
}

export interface MarkdownEditorProps {
  workingTree: WorkingTreeDoc;
  path: string;
}

export function MarkdownEditor({ workingTree, path }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textExists = workingTree.getText(path) !== null;

  useEffect(() => {
    const container = containerRef.current;
    const text = workingTree.getText(path);
    if (!container || !text) return;

    const undo = new FileUndoManager(workingTree.doc, text);

    const view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc: text.toString(),
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          Prec.highest(
            keymap.of([
              {
                key: "Mod-z",
                run: () => {
                  undo.undo();
                  return true;
                },
              },
              {
                key: "Mod-Shift-z",
                run: () => {
                  undo.redo();
                  return true;
                },
              },
              {
                key: "Mod-y",
                run: () => {
                  undo.redo();
                  return true;
                },
              },
            ]),
          ),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (
              update.transactions.some((transaction) =>
                transaction.annotation(externalUpdate),
              )
            ) {
              return;
            }
            applyTextDiff(
              text,
              text.toString(),
              update.state.doc.toString(),
            );
          }),
        ],
      }),
    });

    const observer: Parameters<YText["observe"]>[0] = () => {
      const next = text.toString();
      if (view.state.doc.toString() === next) return;

      const selection = view.state.selection.main;
      const anchor = Math.min(selection.anchor, next.length);
      const head = Math.min(selection.head, next.length);

      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: { anchor, head },
        annotations: externalUpdate.of(true),
      });
    };

    text.observe(observer);

    return () => {
      text.unobserve(observer);
      undo.destroy();
      view.destroy();
    };
  }, [workingTree, path]);

  if (!textExists) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-sm text-zinc-500">
        Select a file to start writing.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 overflow-hidden"
      aria-label={`Editing ${path}`}
    />
  );
}
