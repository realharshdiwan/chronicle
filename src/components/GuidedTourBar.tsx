import { useState } from 'react';
import {
  Activity,
  Download,
  GitMerge,
  PencilLine,
  X,
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace';

export function GuidedTourBar() {
  const {
    refs,
    commits,
    pendingMerge,
    status,
    simulateSampleEdit,
    mergeBranch,
    openCommitInXRay,
    setBackupModalOpen,
  } = useWorkspaceStore();

  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const headHash =
    refs?.head.type === 'branch'
      ? refs.branches[refs.head.branch]
      : refs?.head.commitHash ?? commits[0]?.hash;

  const hasFeatBranch = Boolean(refs?.branches['feat/sync-protocol']);
  const currentBranch =
    refs?.head.type === 'branch' ? refs.head.branch : null;

  return (
    <div
      role="region"
      aria-label="Interactive walkthrough"
      className="hidden sm:flex items-center justify-between gap-4 px-4 py-2 border-b border-indigo-300/[0.12] bg-[#10132B]/70 backdrop-blur-md text-xs shrink-0"
    >
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="text-indigo-200 font-medium whitespace-nowrap shrink-0 mr-1">
          Interactive Tour:
        </span>

        <button
          type="button"
          onClick={simulateSampleEdit}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-indigo-300/18 bg-indigo-500/10 text-indigo-50 hover:bg-cyan-400/18 hover:border-cyan-300/45 transition-colors whitespace-nowrap shrink-0"
        >
          <PencilLine className="w-3.5 h-3.5 text-cyan-300" />
          <span>1. Edit &amp; Diff</span>
        </button>

        {hasFeatBranch && currentBranch === 'main' && (
          <button
            type="button"
            disabled={!status.clean || Boolean(pendingMerge)}
            onClick={() => void mergeBranch('feat/sync-protocol')}
            title={
              !status.clean
                ? 'Commit or reset uncommitted changes first'
                : 'Merge feat/sync-protocol into main to inspect 3-way conflict resolution'
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-indigo-300/18 bg-indigo-500/10 text-indigo-50 hover:bg-amber-400/18 hover:border-amber-300/45 disabled:opacity-45 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0"
          >
            <GitMerge className="w-3.5 h-3.5 text-amber-300" />
            <span>2. Trigger 3-Way Conflict</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => headHash && void openCommitInXRay(headHash)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-indigo-300/18 bg-indigo-500/10 text-indigo-50 hover:bg-emerald-400/18 hover:border-emerald-300/45 transition-colors whitespace-nowrap shrink-0"
        >
          <Activity className="w-3.5 h-3.5 text-emerald-300" />
          <span>3. Inspect Merkle-DAG</span>
        </button>

        <button
          type="button"
          onClick={() => setBackupModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-indigo-300/18 bg-indigo-500/10 text-indigo-50 hover:bg-violet-400/18 hover:border-violet-300/45 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-violet-300" />
          <span>4. Backup &amp; Import</span>
        </button>
      </div>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss interactive tour"
        className="p-1 rounded text-indigo-300 hover:text-white hover:bg-indigo-400/20 transition-colors shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
