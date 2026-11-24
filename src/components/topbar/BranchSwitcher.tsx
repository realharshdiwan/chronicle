import { useState, type FormEvent } from 'react';
import {
  ChevronDown,
  GitBranch,
  GitMerge,
  Menu,
  Plus,
  Trash2,
} from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace';

interface BranchSwitcherProps {
  onToggleMobileSidebar: () => void;
}

export function BranchSwitcher({ onToggleMobileSidebar }: BranchSwitcherProps) {
  const {
    refs,
    pendingMerge,
    workspaces,
    activeWorkspaceId,
    setWorkspaceModalOpen,
    checkoutTarget,
    createBranch,
    deleteBranch,
    mergeBranch,
  } = useWorkspaceStore();

  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [mergeTarget, setMergeTarget] = useState('feat/sync-protocol');
  const [confirmForceDeleteBranch, setConfirmForceDeleteBranch] = useState<string | null>(null);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];
  const currentBranch = refs?.head.type === 'branch' ? refs.head.branch : null;
  const branchNames = Object.keys(refs?.branches ?? {}).sort();
  const otherBranches = branchNames.filter((b) => b !== currentBranch);
  const activeMergeBranch = otherBranches.includes(mergeTarget)
    ? mergeTarget
    : otherBranches[0] ?? '';

  const handleCreateBranch = async (e: FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim()) return;
    const ok = await createBranch(newBranchName);
    if (ok) {
      const created = newBranchName.trim();
      setNewBranchName('');
      setCreatingBranch(false);
      await checkoutTarget(created);
    }
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={onToggleMobileSidebar}
        aria-label="Toggle file explorer"
        className="md:hidden p-2 rounded-md text-indigo-100 hover:bg-indigo-400/15 hover:text-white transition-colors"
      >
        <Menu className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-2 shrink-0">
        <img
          src="/icon.svg"
          alt=""
          className="w-5 h-5 rounded ring-1 ring-violet-300/30"
          aria-hidden="true"
        />
        <span className="font-display text-base font-semibold tracking-tight bg-gradient-to-r from-white via-cyan-100 to-violet-200 bg-clip-text text-transparent whitespace-nowrap">
          Chronicle
        </span>
      </div>

      <button
        type="button"
        onClick={() => setWorkspaceModalOpen(true)}
        aria-label="Switch workspace"
        title="Workspaces & commit author settings"
        className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md border border-indigo-300/18 bg-indigo-500/10 text-xs font-medium text-indigo-100 hover:text-white hover:border-cyan-300/40 hover:bg-indigo-500/20 transition-colors whitespace-nowrap shrink-0"
      >
        <span className="truncate max-w-[92px] xl:max-w-[112px] 2xl:max-w-[140px]">
          {activeWorkspace?.name ?? 'Chronicle Demo'}
        </span>
        <ChevronDown className="w-3 h-3 text-indigo-300 shrink-0" />
      </button>

      <span className="hidden sm:inline text-indigo-400/60 select-none" aria-hidden="true">
        /
      </span>

      <div className="hidden sm:flex items-center gap-1 shrink-0">
        <GitBranch className="w-3.5 h-3.5 text-cyan-300 shrink-0" aria-hidden="true" />
        <label htmlFor="branch-select" className="sr-only">
          Active branch
        </label>
        <select
          id="branch-select"
          value={currentBranch ?? ''}
          onChange={(e) => void checkoutTarget(e.target.value)}
          className="bg-indigo-500/12 border border-indigo-300/20 text-white text-xs font-mono rounded-md px-2 py-1.5 hover:border-cyan-300/40 hover:bg-indigo-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 max-w-[100px] xl:max-w-[115px] 2xl:max-w-[150px] transition-colors"
        >
          {refs?.head.type === 'detached' && (
            <option value="" disabled className="bg-[#141736] text-white">
              HEAD@{refs.head.commitHash.slice(0, 7)}
            </option>
          )}
          {branchNames.map((b) => (
            <option key={b} value={b} className="bg-[#141736] text-white">
              {b}
            </option>
          ))}
        </select>

        {creatingBranch ? (
          <form onSubmit={handleCreateBranch} className="flex items-center gap-1">
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="branch-name"
              aria-label="New branch name"
              autoFocus
              className="w-24 xl:w-28 bg-[#0D1026] border border-indigo-300/30 rounded-md px-2 py-1 text-xs font-mono text-white placeholder:text-indigo-200/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
            <button
              type="submit"
              className="px-2 py-1 text-xs font-semibold bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 rounded-md hover:from-cyan-300 hover:to-violet-300 whitespace-nowrap shrink-0"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setCreatingBranch(false)}
              className="px-1.5 py-1 text-xs text-indigo-200 hover:text-white whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreatingBranch(true)}
            aria-label="New branch"
            title="Create new branch"
            className="p-1.5 rounded-md text-indigo-200 hover:text-white hover:bg-indigo-400/15 transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {otherBranches.length > 0 && (
        <div className="hidden xl:flex items-center gap-1 pl-2 border-l border-indigo-300/15 shrink-0">
          <label htmlFor="merge-target-select" className="sr-only">
            Branch to merge
          </label>
          <select
            id="merge-target-select"
            value={activeMergeBranch}
            onChange={(e) => {
              setMergeTarget(e.target.value);
              setConfirmForceDeleteBranch(null);
            }}
            className="bg-indigo-500/12 border border-indigo-300/20 text-indigo-50 text-xs font-mono rounded-md px-2 py-1.5 hover:border-violet-300/40 hover:bg-indigo-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 max-w-[105px] 2xl:max-w-[145px] transition-colors"
          >
            {otherBranches.map((b) => (
              <option key={b} value={b} className="bg-[#141736] text-white">
                {b}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!activeMergeBranch || Boolean(pendingMerge)}
            onClick={() => activeMergeBranch && void mergeBranch(activeMergeBranch)}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md border border-violet-300/25 bg-violet-500/15 text-violet-100 hover:bg-violet-500/25 hover:border-violet-300/50 disabled:opacity-40 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0"
          >
            <GitMerge className="w-3.5 h-3.5 text-violet-300" />
            <span>Merge</span>
          </button>
          {confirmForceDeleteBranch === activeMergeBranch ? (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (!activeMergeBranch) return;
                  void deleteBranch(activeMergeBranch, true).then(() =>
                    setConfirmForceDeleteBranch(null)
                  );
                }}
                className="px-2 py-1 text-[11px] font-semibold rounded bg-rose-500/80 text-white hover:bg-rose-400 whitespace-nowrap shrink-0"
              >
                Force Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmForceDeleteBranch(null)}
                className="px-1.5 py-1 text-[11px] text-indigo-200 hover:text-white whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!activeMergeBranch || Boolean(pendingMerge)}
              onClick={() => {
                if (!activeMergeBranch) return;
                void deleteBranch(activeMergeBranch, false).then((res) => {
                  if (res === 'unmerged') {
                    setConfirmForceDeleteBranch(activeMergeBranch);
                  }
                });
              }}
              aria-label={`Delete branch ${activeMergeBranch}`}
              title={`Delete branch ${activeMergeBranch}`}
              className="p-1.5 rounded-md text-indigo-300 hover:text-rose-300 hover:bg-rose-500/15 disabled:opacity-40 transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
