import { Archive, FolderGit2, GitBranch } from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace';

interface BranchListSectionProps {
  onCloseMobile: () => void;
}

export function BranchListSection({ onCloseMobile }: BranchListSectionProps) {
  const {
    refs,
    checkoutTarget,
    setWorkspaceModalOpen,
    setBackupModalOpen,
  } = useWorkspaceStore();

  const currentBranch = refs?.head.type === 'branch' ? refs.head.branch : '';
  const branchNames = Object.keys(refs?.branches ?? {}).sort();

  return (
    <>
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
    </>
  );
}
