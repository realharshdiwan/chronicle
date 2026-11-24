import { useEffect, useState, type FormEvent } from 'react';
import {
  Check,
  FolderGit2,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace';

export function WorkspaceModal() {
  const {
    workspaceModalOpen,
    workspaces,
    activeWorkspaceId,
    authorName,
    setWorkspaceModalOpen,
    setAuthorName,
    createWorkspace,
    switchWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = useWorkspaceStore();

  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'blank' | 'demo'>('blank');
  const [authorDraft, setAuthorDraft] = useState(authorName);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    setAuthorDraft(authorName);
  }, [authorName, workspaceModalOpen]);

  if (!workspaceModalOpen) return null;

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const ok = await createWorkspace(newName, newKind);
    if (ok) {
      setNewName('');
    }
  };

  const handleSaveAuthor = (e: FormEvent) => {
    e.preventDefault();
    if (!authorDraft.trim()) return;
    setAuthorName(authorDraft);
  };

  const handleSaveRename = (e: FormEvent, id: string) => {
    e.preventDefault();
    if (!editName.trim()) return;
    if (renameWorkspace(id, editName)) {
      setEditingId(null);
      setEditName('');
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Workspaces and author settings"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050611]/72 backdrop-blur-md"
      onClick={() => setWorkspaceModalOpen(false)}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-indigo-300/25 bg-[#121530]/94 backdrop-blur-2xl shadow-[0_24px_70px_rgba(4,6,22,0.85)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-indigo-300/15 bg-indigo-950/35 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-400/15 border border-cyan-300/35 text-cyan-200">
              <FolderGit2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">
                Local Workspaces &amp; Identity
              </h2>
              <p className="text-[11px] text-indigo-200">
                Each workspace runs its own isolated IndexedDB Merkle-DAG, CRDT tree &amp; search index
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWorkspaceModalOpen(false)}
            aria-label="Close workspaces dialog"
            className="p-1.5 rounded text-indigo-200 hover:text-white hover:bg-indigo-400/20"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* Existing Workspaces */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-indigo-100">
                Your IndexedDB Notebooks
              </span>
              <span className="font-mono text-[11px] text-indigo-200/75 tabular-nums">
                {workspaces.length} total
              </span>
            </div>

            <div className="space-y-2">
              {workspaces.map((ws) => {
                const isActive = ws.id === activeWorkspaceId;
                const isEditing = editingId === ws.id;

                return (
                  <div
                    key={ws.id}
                    className={`rounded-lg border px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                      isActive
                        ? 'border-cyan-300/45 bg-gradient-to-r from-cyan-400/12 to-violet-400/12'
                        : 'border-indigo-300/18 bg-indigo-950/35 hover:border-indigo-300/35'
                    }`}
                  >
                    {isEditing ? (
                      <form
                        onSubmit={(e) => handleSaveRename(e, ws.id)}
                        className="flex-1 flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          aria-label="Rename workspace"
                          autoFocus
                          className="flex-1 min-w-0 bg-[#090B19]/85 border border-cyan-300/50 rounded px-2.5 py-1 text-xs text-white focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="px-2.5 py-1 text-xs font-semibold rounded bg-cyan-400 text-slate-950 hover:bg-cyan-300"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-2 py-1 text-xs text-indigo-200 hover:text-white"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs font-semibold text-white">
                            <span className="truncate">{ws.name}</span>
                            {isActive && (
                              <span className="text-[11px] font-mono font-medium text-emerald-300">
                                · Active
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-indigo-200/75 font-mono flex items-center gap-2">
                            <span>{ws.kind}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              Updated {new Date(ws.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isActive && (
                            <button
                              type="button"
                              onClick={() => void switchWorkspace(ws.id)}
                              className="px-2.5 py-1 text-xs font-medium rounded-md border border-cyan-300/35 bg-cyan-400/15 text-cyan-100 hover:bg-cyan-400/25 hover:text-white transition-colors"
                            >
                              Open
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(ws.id);
                              setEditName(ws.name);
                            }}
                            aria-label={`Rename workspace ${ws.name}`}
                            title="Rename workspace"
                            className="p-1.5 rounded text-indigo-200 hover:text-white hover:bg-indigo-400/20 transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {workspaces.length > 1 && (
                            <button
                              type="button"
                              onClick={() => void deleteWorkspace(ws.id)}
                              aria-label={`Delete workspace ${ws.name}`}
                              title="Delete workspace and its IndexedDB data"
                              className="p-1.5 rounded text-indigo-200 hover:text-rose-300 hover:bg-rose-400/15 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Create New Workspace */}
          <form
            onSubmit={handleCreate}
            className="pt-4 border-t border-indigo-300/15 space-y-3"
          >
            <div className="text-xs font-semibold text-indigo-100">
              Create New Workspace
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <label htmlFor="new-workspace-name" className="sr-only">
                New workspace name
              </label>
              <input
                id="new-workspace-name"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Architecture Notes, Journal..."
                className="flex-1 min-w-0 bg-[#090B19]/80 border border-indigo-300/25 rounded-md px-3 py-2 text-xs text-white placeholder:text-indigo-200/50 focus:outline-none focus:border-cyan-300"
              />
              <div
                role="radiogroup"
                aria-label="New workspace template"
                className="flex items-center p-0.5 rounded-md border border-indigo-300/20 bg-[#090B19]/75 shrink-0"
              >
                <button
                  type="button"
                  onClick={() => setNewKind('blank')}
                  className={`px-2.5 py-1.5 text-[11px] font-medium rounded transition-colors ${
                    newKind === 'blank'
                      ? 'bg-gradient-to-r from-cyan-400/25 to-violet-400/25 text-white ring-1 ring-cyan-300/35'
                      : 'text-indigo-200 hover:text-white'
                  }`}
                >
                  Blank
                </button>
                <button
                  type="button"
                  onClick={() => setNewKind('demo')}
                  className={`px-2.5 py-1.5 text-[11px] font-medium rounded transition-colors ${
                    newKind === 'demo'
                      ? 'bg-gradient-to-r from-cyan-400/25 to-violet-400/25 text-white ring-1 ring-cyan-300/35'
                      : 'text-indigo-200 hover:text-white'
                  }`}
                >
                  Demo Repo
                </button>
              </div>
              <button
                type="submit"
                disabled={!newName.trim()}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 hover:from-cyan-300 hover:to-violet-300 disabled:opacity-40 transition-all whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create</span>
              </button>
            </div>
          </form>

          {/* Commit Author Identity */}
          <form
            onSubmit={handleSaveAuthor}
            className="pt-4 border-t border-indigo-300/15 space-y-2.5"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-100">
              <UserCheck className="w-3.5 h-3.5 text-emerald-300" />
              <span>Local Commit Author Identity</span>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="commit-author-input" className="sr-only">
                Commit author name
              </label>
              <input
                id="commit-author-input"
                type="text"
                value={authorDraft}
                onChange={(e) => setAuthorDraft(e.target.value)}
                placeholder="Your name for commit signatures"
                className="flex-1 min-w-0 bg-[#090B19]/80 border border-indigo-300/25 rounded-md px-3 py-2 text-xs text-white placeholder:text-indigo-200/50 focus:outline-none focus:border-emerald-300"
              />
              <button
                type="submit"
                disabled={!authorDraft.trim() || authorDraft.trim() === authorName}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border border-emerald-300/35 bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/25 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Author</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
