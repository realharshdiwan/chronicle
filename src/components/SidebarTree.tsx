import { useState, type FormEvent } from 'react';
import { FilePlus2, FolderOpen, GitCommitHorizontal, Search, X } from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace';
import { BranchListSection } from './sidebar/BranchListSection';
import { CreateFileRow } from './sidebar/CreateFileRow';
import { FileTreeNode } from './sidebar/FileTreeNode';

interface SidebarTreeProps {
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function SidebarTree({ mobileOpen, onCloseMobile }: SidebarTreeProps) {
  const {
    filePaths,
    activeFile,
    status,
    commits,
    searchStats,
    setViewMode,
    setSearchOpen,
    commitChanges,
    openCommitInXRay,
  } = useWorkspaceStore();

  const [addingFile, setAddingFile] = useState(false);
  const [mobileCommitMsg, setMobileCommitMsg] = useState('');

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
  const allDisplayPaths = Array.from(new Set([...filePaths, ...status.deleted])).sort();

  const content = (
    <aside className="w-64 h-full glass-sidebar border-r border-indigo-300/[0.16] flex flex-col select-none relative z-10">
      <div className="px-4 py-3 border-b border-indigo-300/[0.14] bg-indigo-500/[0.06] flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-indigo-50">Workspace Files</span>
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

      <div className="px-3 py-2 border-b border-indigo-300/[0.12] bg-indigo-950/25">
        <button
          type="button"
          onClick={() => { setSearchOpen(true); onCloseMobile(); }}
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

      <BranchListSection onCloseMobile={onCloseMobile} />
      {addingFile && <CreateFileRow onClose={() => setAddingFile(false)} />}

      <nav aria-label="Workspace files" className="flex-1 overflow-y-auto py-2.5 px-2 space-y-3">
        {allDisplayPaths.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-indigo-200/70">No files in working tree.</div>
        ) : (
          sortedGroups.map((group) => (
            <div key={group || '__root'} className="space-y-0.5">
              {group && (
                <div className="px-2 py-1 flex items-center gap-1.5 text-xs font-medium text-indigo-200">
                  <FolderOpen className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                  <span className="truncate">{group}</span>
                </div>
              )}
              {(grouped.get(group) ?? []).map((path) => (
                <FileTreeNode
                  key={path}
                  path={path}
                  label={group ? path.slice(group.length + 1) : path}
                  isActive={activeFile === path}
                  change={status.changes[path]}
                  onCloseMobile={onCloseMobile}
                />
              ))}
            </div>
          ))
        )}

        {status.deleted.length > 0 && (
          <div className="space-y-0.5 pt-2 border-t border-indigo-300/[0.12]">
            <div className="px-2 py-1 text-xs font-medium text-rose-300">Deleted</div>
            {status.deleted.map((path) => (
              <button
                key={`del-${path}`}
                type="button"
                onClick={() => setViewMode('diff')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono text-rose-200 hover:bg-rose-400/10"
              >
                <span className="truncate line-through">{path}</span>
                <span className="font-mono text-[11px] font-semibold text-rose-300">D</span>
              </button>
            ))}
          </div>
        )}
      </nav>

      {recentCommits.length > 0 && (
        <div className="px-3 py-2.5 border-t border-indigo-300/[0.14] bg-indigo-500/[0.04] space-y-1.5">
          <div className="px-1 text-[11px] font-semibold text-indigo-100">Recent Commits</div>
          <div className="space-y-0.5">
            {recentCommits.map((c) => (
              <button
                key={c.hash}
                type="button"
                onClick={() => { void openCommitInXRay(c.hash); onCloseMobile(); }}
                className="w-full px-1.5 py-1 rounded flex items-center gap-1.5 text-left text-[11px] text-indigo-100 hover:bg-indigo-400/15 hover:text-white transition-colors"
              >
                <GitCommitHorizontal className="w-3 h-3 text-violet-300 shrink-0" />
                <span className="font-mono text-cyan-300 shrink-0 tabular-nums">{c.hash.slice(0, 7)}</span>
                <span className="truncate text-indigo-100/90">{c.message}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!status.clean && (
        <form onSubmit={handleMobileCommit} className="md:hidden p-3 border-t border-indigo-300/[0.14] bg-indigo-500/[0.05] flex flex-col gap-2">
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

      <div className="px-4 py-2.5 border-t border-indigo-300/[0.14] bg-indigo-500/[0.05] flex items-center justify-between text-xs">
        <span className="text-indigo-200">Working tree</span>
        <span className={`font-mono font-semibold tabular-nums ${
          status.conflicted.length > 0 ? 'text-rose-300' : status.clean ? 'text-emerald-300' : 'text-amber-300'
        }`}>
          {status.conflicted.length > 0 ? `${status.conflicted.length} conflict` : status.clean ? 'Clean' : `${status.modified.length + status.added.length + status.deleted.length} changed`}
        </span>
      </div>
    </aside>
  );

  return (
    <div className={mobileOpen ? 'fixed inset-0 z-40 flex md:static md:inset-auto md:z-auto md:h-full md:shrink-0' : 'hidden md:flex h-full shrink-0'}>
      <div className="relative z-10 h-full">{content}</div>
      {mobileOpen && <div className="flex-1 bg-[#050611]/70 backdrop-blur-sm md:hidden" onClick={onCloseMobile} aria-hidden="true" />}
    </div>
  );
}
