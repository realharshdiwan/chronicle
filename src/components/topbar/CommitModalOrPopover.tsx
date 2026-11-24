import { useState, type FormEvent } from 'react';
import { useWorkspaceStore } from '../../state/workspace';

export function CommitModalOrPopover() {
  const { status, pendingMerge, commitChanges } = useWorkspaceStore();
  const [commitMsg, setCommitMsg] = useState('');

  const handleCommit = async (e: FormEvent) => {
    e.preventDefault();
    if (!commitMsg.trim() || status.clean || pendingMerge) return;
    const ok = await commitChanges(commitMsg);
    if (ok) setCommitMsg('');
  };

  return (
    <form
      onSubmit={handleCommit}
      className="hidden md:flex items-center gap-1.5 flex-1 min-w-[155px] max-w-xs"
    >
      <label htmlFor="commit-message-input" className="sr-only">
        Commit message
      </label>
      <input
        id="commit-message-input"
        type="text"
        value={commitMsg}
        onChange={(e) => setCommitMsg(e.target.value)}
        placeholder={
          pendingMerge
            ? 'Resolve in Diff...'
            : status.clean
              ? 'Edit to commit...'
              : 'Commit note...'
        }
        disabled={status.clean || Boolean(pendingMerge)}
        className="flex-1 min-w-0 bg-indigo-950/45 border border-indigo-300/20 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-indigo-200/55 focus:outline-none focus:bg-indigo-950/65 focus:border-cyan-300/75 disabled:opacity-55 transition-colors"
      />
      <button
        type="submit"
        disabled={!commitMsg.trim() || status.clean || Boolean(pendingMerge)}
        className="px-3 py-1.5 text-xs font-semibold rounded-md bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 hover:from-cyan-300 hover:to-violet-300 disabled:bg-none disabled:bg-indigo-500/15 disabled:text-indigo-200/50 transition-all whitespace-nowrap shrink-0"
      >
        Commit
      </button>
    </form>
  );
}
