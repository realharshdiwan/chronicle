import { useState } from 'react';
import { FileText, Pencil, Trash2 } from 'lucide-react';
import type { FileChangeStatus } from '../../core/types';
import { useWorkspaceStore } from '../../state/workspace';

interface FileTreeNodeProps {
  path: string;
  label: string;
  isActive: boolean;
  change?: FileChangeStatus;
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

export function FileTreeNode({
  path,
  label,
  isActive,
  change,
  onCloseMobile,
}: FileTreeNodeProps) {
  const { setActiveFile, setViewMode, renameFile, deleteFile } = useWorkspaceStore();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(path);

  const badge = change ? STATUS_BADGE[change] : null;

  if (isRenaming) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (renameFile(path, renameValue)) {
            setIsRenaming(false);
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
              setIsRenaming(false);
              setRenameValue(path);
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
            setIsRenaming(true);
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
}
