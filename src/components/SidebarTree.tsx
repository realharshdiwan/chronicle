import { useState, type FormEvent } from 'react';
import {
  Archive,
  FilePlus2,
  FileText,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { FileChangeStatus } from '../core/types';
import { useWorkspaceStore } from '../state/workspace';

interface SidebarTreeProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const STATUS_BADGE: Record<
  FileChangeStatus,
  { code: string; label: string; cls: string }
> = {
  modified: { code: 'M', label: 'Modified', cls: 'text-amber-300' },
  added: { code: 'A', label: 'Added', cls: 'text-emerald-300' },
  deleted: { code: 'D', label: 'Deleted', cls: 'text-rose-300' },
  conflicted: { code: '!', label: 'Conflict', cls: 'text-rose-300 font-bold' },
};

export function SidebarTree({ mobileOpen, onCloseMobile }: SidebarTreeProps) {
  const {
    filePaths,
    activeFile,
    status,
    commits,
    refs,
    searchStats,
    setActiveFile,
    setViewMode,
    setSearchOpen,
    setWorkspaceModalOpen,
    setBackupModalOpen,
    createFile,
    renameFile,
    deleteFile,
    commitChanges,
    checkoutTarget,
    openCommitInXRay,
  } = useWorkspaceStore();

  const currentBranch =
    refs?.head.type === 'branch' ? refs.head.branch : '';
  const branchNames = Object.keys(refs?.branches ?? {}).sort();

  const [addingFile, setAddingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [mobileCommitMsg, setMobileCommitMsg] = useState('');

  const handleCreateFile = (e: FormEvent) => {
    e.preventDefault();
    if (!newFilePath.trim()) return;
    createFile(newFilePath, `# ${newFilePath.trim()}\n\n`);
    setNewFilePath('');
    setAddingFile(false);
  };

  const handleMobileCommit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mobileCommitMsg.trim() || status.clean) return;
    const ok = await commitChanges(mobileCommitMsg);
    if (ok) setMobileCommitMsg('');
  };

  const grouped = new Map<string, string[]>();
  for (const path of filePaths) {
    const slashIdx = path.indexOf('/');
    const group = slashIdx === -1 ? '' : path.slice(0, slashIdx);
    const list = grouped.get(group) ?? [];
    list.push(path);
    grouped.set(group, list);
  }
  const sortedGroups = Array.from(grouped.keys()).sort();

  const recentCommits = commits.slice(0, 3);
  const allDisplayPaths = Array.from(
    new Set([...filePaths, ...status.deleted])
  ).sort();

  const content = (
    <aside className="w-64 h-full glass-sidebar border-r border-indigo-300/[0.16] flex flex-col select-none relative z-10">
      {/* Header */}
      <div className="px-4 py-3 border-b border-indigo-300/[0.14] bg-indigo-500/[0.06] flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-indigo-50">
          Workspace Files
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAddingFile((v) => !v)}
            aria-label="New file"
            title="New file"
            className="p-1.5 rounded text-indigo-200 hover:text-white hover:bg-indigo-400/20 transition-colors"
          >
            <FilePlus2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close sidebar"
            className="md:hidden p-1.5 rounded text-indigo-200 hover:text-white hover:bg-indigo-400/20"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick Full-Text Index Trigger */}
      <div className="px-3 py-2 border-b border-indigo-300/[0.12] bg-indigo-950/25">
        <button
          type="button"
          onClick={() => {
            setSearchOpen(true);
            onCloseMobile();
          }}
          className="w-full px-2.5 py-1.5 rounded-md border border-indigo-300/20 bg-indigo-950/45 hover:bg-indigo-900/55 hover:border-cyan-300/45 flex items-center justify-between gap-2 text-xs text-indigo-200 hover:text-white transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Search className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span className="truncate">Search all blobs...</span>
          </span>
          <span className="font-mono text-[10px] text-violet-200/80 shrink-0 tabular-nums">
            {searchStats.indexedBlobCount > 0 ? `${searchStats.indexedBlobCount} blobs` : '⌘⇧F'}
          </span>
        </button>
      </div>

      {/* Mobile Branch Switcher */}
      {branchNames.length > 0 && (
        <div className="sm:hidden px-3 py-2.5 border-b border-indigo-300/[0.12] bg-indigo-500/[0.05] flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
          <label htmlFor="mobile-branch-select" className="sr-only">
            Mobile active branch
          </label>
          <select
            id="mobile-branch-select"
            value={currentBranch}
            onChange={(e) => {
              void checkoutTarget(e.target.value);
              onCloseMobile();
            }}
            className="w-full bg-indigo-950/60 border border-indigo-300/20 rounded px-2 py-1 text-xs font-mono text-white"
          >
            {branchNames.map((b) => (
              <option key={b} value={b} className="bg-[#141736] text-white">
                {b}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Mobile Workspace & Backup Actions */}
      <div className="sm:hidden px-3 py-2 border-b border-indigo-300/[0.12] bg-indigo-500/[0.04] grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => {
            setWorkspaceModalOpen(true);
            onCloseMobile();
          }}
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-indigo-300/20 bg-indigo-950/45 text-[11px] font-medium text-indigo-100 hover:text-white"
        >
          <FolderGit2 className="w-3.5 h-3.5 text-cyan-300" />
          <span>Workspaces</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setBackupModalOpen(true);
            onCloseMobile();
          }}
          className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-indigo-300/20 bg-indigo-950/45 text-[11px] font-medium text-indigo-100 hover:text-white"
        >
          <Archive className="w-3.5 h-3.5 text-violet-300" />
          <span>Backup</span>
        </button>
      </div>

      {/* Inline New File Form */}
      {addingFile && (
        <form
          onSubmit={handleCreateFile}
          className="px-3 py-2.5 border-b border-indigo-300/[0.12] bg-indigo-500/[0.06] flex flex-col gap-2"
        >
          <label htmlFor="new-file-input" className="sr-only">
            New file path
          </label>
          <input
            id="new-file-input"
            type="text"
            value={newFilePath}
            onChange={(e) => setNewFilePath(e.target.value)}
            placeholder="notes/idea.md"
            autoFocus
            className="w-full bg-indigo-950/60 border border-indigo-300/25 rounded px-2.5 py-1.5 text-xs font-mono text-white placeholder:text-indigo-200/50 focus:outline-none focus:border-cyan-300"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setAddingFile(false)}
              className="px-2 py-1 text-xs text-indigo-200 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-2.5 py-1 text-xs font-semibold bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 rounded hover:from-cyan-300 hover:to-violet-300"
            >
              Add File
            </button>
          </div>
        </form>
      )}

      {/* File Tree */}
      <nav aria-label="Workspace files" className="flex-1 overflow-y-auto py-2.5 px-2 space-y-3">
        {allDisplayPaths.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-indigo-200/70">
            No files in working tree.
          </div>
        ) : (
          sortedGroups.map((group) => {
            const items = grouped.get(group) ?? [];
            return (
              <div key={group || '__root'} className="space-y-0.5">
                {group && (
                  <div className="px-2 py-1 flex items-center gap-1.5 text-xs font-medium text-indigo-200">
                    <FolderOpen className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                    <span className="truncate">{group}</span>
                  </div>
                )}
                {items.map((path) => {
                  const isActive = activeFile === path;
                  const change = status.changes[path];
                  const badge = change ? STATUS_BADGE[change] : null;
                  const label = group ? path.slice(group.length + 1) : path;
                  const isRenaming = renamingPath === path;

                  if (isRenaming) {
                    return (
                      <form
                        key={path}
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (renameFile(path, renameValue)) {
                            setRenamingPath(null);
                            setRenameValue('');
                          }
                        }}
                        className="px-1.5 py-1 flex items-center gap-1 bg-indigo-950/70 rounded-md border border-cyan-300/45"
                      >
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setRenamingPath(null);
                              setRenameValue('');
                            }
                          }}
                          aria-label={`New path for ${path}`}
                          autoFocus
                          className="flex-1 min-w-0 bg-transparent text-xs font-mono text-white focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-cyan-400 text-slate-950 hover:bg-cyan-300 shrink-0"
                        >
                          Save
                        </button>
                      </form>
                    );
                  }

                  return (
                    <div
                      key={path}
                      className={`group flex items-center justify-between rounded-md transition-colors ${
                        isActive
                          ? 'bg-gradient-to-r from-cyan-400/20 to-violet-400/20 text-white ring-1 ring-cyan-300/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                          : 'text-indigo-100/90 hover:bg-indigo-400/[0.11] hover:text-white'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setActiveFile(path);
                          setViewMode('editor');
                          onCloseMobile();
                        }}
                        className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-left text-xs font-mono truncate"
                      >
                        <FileText
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isActive ? 'text-cyan-300' : 'text-indigo-300/75'
                          }`}
                        />
                        <span className="truncate">{label}</span>
                      </button>

                      <div className="flex items-center gap-0.5 pr-1 shrink-0">
                        {badge && (
                          <span
                            title={badge.label}
                            aria-label={`${path} ${badge.label}`}
                            className={`font-mono text-[11px] font-semibold px-1 tabular-nums ${badge.cls}`}
                          >
                            {badge.code}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingPath(path);
                            setRenameValue(path);
                          }}
                          aria-label={`Rename ${path}`}
                          title={`Rename ${path}`}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-indigo-300 hover:text-cyan-200 transition-opacity"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteFile(path)}
                          aria-label={`Delete ${path}`}
                          title={`Delete ${path}`}
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded text-indigo-300 hover:text-rose-300 transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}

        {status.deleted.length > 0 && (
          <div className="space-y-0.5 pt-2 border-t border-indigo-300/[0.12]">
            <div className="px-2 py-1 text-xs font-medium text-rose-300">
              Deleted
            </div>
            {status.deleted.map((path) => (
              <button
                key={`del-${path}`}
                type="button"
                onClick={() => setViewMode('diff')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono text-rose-200 hover:bg-rose-400/10"
              >
                <span className="truncate line-through">{path}</span>
                <span className="font-mono text-[11px] font-semibold text-rose-300">
                  D
                </span>
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* Recent Commits Quick Timeline */}
      {recentCommits.length > 0 && (
        <div className="px-3 py-2.5 border-t border-indigo-300/[0.14] bg-indigo-500/[0.04] space-y-1.5">
          <div className="px-1 text-[11px] font-semibold text-indigo-100">
            Recent Commits
          </div>
          <div className="space-y-0.5">
            {recentCommits.map((c) => (
              <button
                key={c.hash}
                type="button"
                onClick={() => {
                  void openCommitInXRay(c.hash);
                  onCloseMobile();
                }}
                className="w-full px-1.5 py-1 rounded flex items-center gap-1.5 text-left text-[11px] text-indigo-100 hover:bg-indigo-400/15 hover:text-white transition-colors"
              >
                <GitCommitHorizontal className="w-3 h-3 text-violet-300 shrink-0" />
                <span className="font-mono text-cyan-300 shrink-0 tabular-nums">
                  {c.hash.slice(0, 7)}
                </span>
                <span className="truncate text-indigo-100/90">{c.message}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mobile Commit Box */}
      {!status.clean && (
        <form
          onSubmit={handleMobileCommit}
          className="md:hidden p-3 border-t border-indigo-300/[0.14] bg-indigo-500/[0.05] flex flex-col gap-2"
        >
          <input
            type="text"
            value={mobileCommitMsg}
            onChange={(e) => setMobileCommitMsg(e.target.value)}
            placeholder="Commit message..."
            aria-label="Mobile commit message"
            className="w-full bg-indigo-950/60 border border-indigo-300/25 rounded px-2.5 py-1.5 text-xs text-white placeholder:text-indigo-200/55"
          />
          <button
            type="submit"
            disabled={!mobileCommitMsg.trim()}
            className="w-full py-1.5 text-xs font-semibold rounded bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 disabled:opacity-40"
          >
            Commit Changes
          </button>
        </form>
      )}

      {/* Footer Summary */}
      <div className="px-4 py-2.5 border-t border-indigo-300/[0.14] bg-indigo-500/[0.05] flex items-center justify-between text-xs">
        <span className="text-indigo-200">Working tree</span>
        <span
          className={`font-mono font-semibold tabular-nums ${
            status.conflicted.length > 0
              ? 'text-rose-300'
              : status.clean
                ? 'text-emerald-300'
                : 'text-amber-300'
          }`}
        >
          {status.conflicted.length > 0
            ? `${status.conflicted.length} conflict`
            : status.clean
              ? 'Clean'
              : `${
                  status.modified.length +
                  status.added.length +
                  status.deleted.length
                } changed`}
        </span>
      </div>
    </aside>
  );

  return (
    <div
      className={
        mobileOpen
          ? 'fixed inset-0 z-40 flex md:static md:inset-auto md:z-auto md:h-full md:shrink-0'
          : 'hidden md:flex h-full shrink-0'
      }
    >
      <div className="relative z-10 h-full">{content}</div>
      {mobileOpen && (
        <div
          className="flex-1 bg-[#050611]/70 backdrop-blur-sm md:hidden"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
