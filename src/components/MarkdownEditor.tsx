import { useEffect, useRef, useState } from 'react';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import {
  Columns2,
  Download,
  Eye,
  FilePlus2,
  GitCompare,
  PenLine,
  Redo2,
  Undo2,
} from 'lucide-react';
import type * as Y from 'yjs';
import { LOCAL_EDIT_ORIGIN } from '../core/crdt/origins';
import { applyTextDelta } from '../core/crdt/WorkingTreeDoc';
import { useWorkspaceStore } from '../state/workspace';
import { MarkdownPreview } from './MarkdownPreview';

type AuthorLayout = 'edit' | 'split' | 'preview';

const chronicleEditorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: '#F8FAFC',
      height: '100%',
    },
    '.cm-content': {
      padding: '24px 28px',
      caretColor: '#22D3EE',
      fontFamily: 'var(--font-mono)',
    },
    '.cm-line': {
      lineHeight: '1.72',
    },
    '&.cm-focused .cm-cursor': {
      borderLeftColor: '#22D3EE',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(139, 92, 246, 0.30)',
    },
    '.cm-gutters': {
      backgroundColor: 'rgba(13, 16, 40, 0.72)',
      color: '#818CF8',
      borderRight: '1px solid rgba(165, 180, 252, 0.14)',
      paddingRight: '8px',
      userSelect: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(139, 92, 246, 0.14)',
      color: '#67E8F9',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(129, 140, 248, 0.065)',
    },
  },
  { dark: true }
);

const chronicleHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, color: '#FDE047', fontWeight: '700' },
    { tag: tags.strong, color: '#F472B6', fontWeight: '600' },
    { tag: tags.emphasis, color: '#C4B5FD', fontStyle: 'italic' },
    { tag: tags.link, color: '#22D3EE', textDecoration: 'underline' },
    { tag: tags.url, color: '#67E8F9' },
    { tag: tags.monospace, color: '#34D399' },
    { tag: tags.quote, color: '#A5B4FC', fontStyle: 'italic' },
    { tag: tags.list, color: '#A78BFA' },
  ])
);

export function MarkdownEditor() {
  const {
    services,
    activeFile,
    files,
    status,
    canUndoActive,
    canRedoActive,
    undoActiveFile,
    redoActiveFile,
    setViewMode,
    createFile,
  } = useWorkspaceStore();

  const [authorLayout, setAuthorLayout] = useState<AuthorLayout>(() =>
    typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'split' : 'edit'
  );

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const syncingRef = useRef(false);

  const activeContent = activeFile ? files[activeFile] ?? '' : '';
  const activeChange = activeFile ? status.changes[activeFile] : undefined;

  useEffect(() => {
    if (authorLayout === 'preview') return;
    const host = hostRef.current;
    if (!host || !services || !activeFile) return;

    const yText: Y.Text | undefined = services.workingTree.getFileText(activeFile);
    if (!yText) return;

    const startDoc = yText.toString();

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged || syncingRef.current) return;
      const nextText = update.state.doc.toString();
      syncingRef.current = true;
      try {
        services.workingTree.doc.transact(() => {
          applyTextDelta(yText, nextText);
        }, LOCAL_EDIT_ORIGIN);
      } finally {
        syncingRef.current = false;
      }
    });

    const undoKeymap = keymap.of([
      {
        key: 'Mod-z',
        run: () => {
          services.undoManager.undo(activeFile);
          return true;
        },
      },
      {
        key: 'Mod-Shift-z',
        run: () => {
          services.undoManager.redo(activeFile);
          return true;
        },
      },
      {
        key: 'Mod-y',
        run: () => {
          services.undoManager.redo(activeFile);
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: startDoc,
      extensions: [
        lineNumbers(),
        markdown(),
        chronicleEditorTheme,
        chronicleHighlight,
        EditorView.lineWrapping,
        undoKeymap,
        keymap.of(defaultKeymap),
        updateListener,
      ],
    });

    const view = new EditorView({
      state,
      parent: host,
    });
    viewRef.current = view;

    const yObserver = () => {
      if (syncingRef.current) return;
      const remoteStr = yText.toString();
      const editorStr = view.state.doc.toString();
      if (remoteStr === editorStr) return;

      syncingRef.current = true;
      try {
        let start = 0;
        const minLen = Math.min(editorStr.length, remoteStr.length);
        while (
          start < minLen &&
          editorStr.charCodeAt(start) === remoteStr.charCodeAt(start)
        ) {
          start++;
        }
        let oldEnd = editorStr.length;
        let newEnd = remoteStr.length;
        while (
          oldEnd > start &&
          newEnd > start &&
          editorStr.charCodeAt(oldEnd - 1) === remoteStr.charCodeAt(newEnd - 1)
        ) {
          oldEnd--;
          newEnd--;
        }

        view.dispatch({
          changes: {
            from: start,
            to: oldEnd,
            insert: remoteStr.slice(start, newEnd),
          },
        });
      } finally {
        syncingRef.current = false;
      }
    };

    yText.observe(yObserver);

    return () => {
      yText.unobserve(yObserver);
      view.destroy();
      viewRef.current = null;
    };
  }, [services, activeFile, authorLayout]);

  if (!activeFile) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <h2 className="font-display text-lg font-semibold text-white">
          No document selected
        </h2>
        <p className="mt-1.5 text-sm text-slate-300 max-w-sm">
          Choose a file from the explorer or create a new Markdown document in your
          local CRDT working tree.
        </p>
        <button
          type="button"
          onClick={() => createFile('notes/untitled.md', '# Untitled Note\n\n')}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 hover:from-cyan-300 hover:to-violet-300 transition-colors"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
          Create New File
        </button>
      </div>
    );
  }

  const lineCount = activeContent ? activeContent.split('\n').length : 1;
  const wordCount = activeContent.trim()
    ? activeContent.trim().split(/\s+/).length
    : 0;
  const byteCount = new TextEncoder().encode(activeContent).byteLength;

  const handleDownloadMarkdown = () => {
    const blob = new Blob([activeContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.split('/').pop() ?? 'document.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-[#090C1C]/45">
      {/* Editor Sub-header */}
      <div className="h-11 px-4 border-b border-indigo-300/[0.14] glass-panel flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0 text-xs">
          <span className="font-mono text-cyan-100 font-medium truncate">
            {activeFile}
          </span>
          {activeChange && (
            <>
              <span className="text-indigo-400" aria-hidden="true">
                ·
              </span>
              <span
                className={`font-medium capitalize ${
                  activeChange === 'conflicted'
                    ? 'text-rose-300'
                    : activeChange === 'added'
                      ? 'text-emerald-300'
                      : 'text-amber-300'
                }`}
              >
                {activeChange}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="hidden xl:flex items-center gap-2 text-[11px] font-mono text-indigo-200/80 tabular-nums">
            <span>{wordCount} words</span>
            <span aria-hidden="true">·</span>
            <span>{lineCount} lines</span>
            <span aria-hidden="true">·</span>
            <span>{byteCount} B</span>
          </div>

          {/* Author Layout Mode */}
          <div
            role="group"
            aria-label="Editor layout mode"
            className="flex items-center p-0.5 rounded-md border border-indigo-300/20 bg-indigo-950/60"
          >
            <button
              type="button"
              onClick={() => setAuthorLayout('edit')}
              aria-pressed={authorLayout === 'edit'}
              title="Source editor only"
              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                authorLayout === 'edit'
                  ? 'bg-gradient-to-r from-cyan-400/25 to-violet-400/25 text-white ring-1 ring-cyan-300/35 shadow-sm'
                  : 'text-indigo-200 hover:text-white'
              }`}
            >
              <PenLine className="w-3 h-3" />
              <span className="hidden sm:inline">Edit</span>
            </button>
            <button
              type="button"
              onClick={() => setAuthorLayout('split')}
              aria-pressed={authorLayout === 'split'}
              title="Side-by-side editor and rendered Markdown preview"
              className={`hidden md:inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                authorLayout === 'split'
                  ? 'bg-gradient-to-r from-cyan-400/25 to-violet-400/25 text-white ring-1 ring-cyan-300/35 shadow-sm'
                  : 'text-indigo-200 hover:text-white'
              }`}
            >
              <Columns2 className="w-3 h-3" />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => setAuthorLayout('preview')}
              aria-pressed={authorLayout === 'preview'}
              title="Rendered Markdown preview"
              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                authorLayout === 'preview'
                  ? 'bg-gradient-to-r from-cyan-400/25 to-violet-400/25 text-white ring-1 ring-cyan-300/35 shadow-sm'
                  : 'text-indigo-200 hover:text-white'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span className="hidden sm:inline">Preview</span>
            </button>
          </div>

          <div className="flex items-center gap-0.5 border-l border-indigo-300/15 pl-2">
            <button
              type="button"
              onClick={undoActiveFile}
              disabled={!canUndoActive}
              aria-label="Undo edit"
              title="Undo (⌘Z)"
              className="p-1.5 rounded text-indigo-100 hover:bg-indigo-400/15 hover:text-white disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={redoActiveFile}
              disabled={!canRedoActive}
              aria-label="Redo edit"
              title="Redo (⌘⇧Z)"
              className="p-1.5 rounded text-indigo-100 hover:bg-indigo-400/15 hover:text-white disabled:opacity-35 disabled:pointer-events-none transition-colors"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleDownloadMarkdown}
              aria-label={`Download ${activeFile}`}
              title="Download Markdown file"
              className="p-1.5 rounded text-indigo-100 hover:bg-indigo-400/15 hover:text-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>

          {activeChange && (
            <button
              type="button"
              onClick={() => setViewMode('diff')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-amber-400/45 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25 transition-colors whitespace-nowrap shrink-0"
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Diff</span>
            </button>
          )}
        </div>
      </div>

      {/* Editor & Live Preview Split Canvas */}
      <div className="flex-1 min-h-0 flex">
        {authorLayout !== 'preview' && (
          <div
            ref={hostRef}
            data-testid="markdown-editor"
            className={`${
              authorLayout === 'split'
                ? 'w-1/2 border-r border-indigo-300/[0.14]'
                : 'w-full'
            } min-w-0 h-full overflow-hidden bg-[#0A0D1E]/45`}
          />
        )}

        {authorLayout !== 'edit' && (
          <div
            data-testid="markdown-preview"
            className={`${
              authorLayout === 'split' ? 'w-1/2' : 'w-full'
            } min-w-0 h-full overflow-y-auto bg-[#10142D]/55 backdrop-blur-sm`}
          >
            <MarkdownPreview content={activeContent} />
          </div>
        )}
      </div>
    </div>
  );
}
