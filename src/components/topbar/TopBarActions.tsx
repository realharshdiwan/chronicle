import {
  Activity,
  Archive,
  Command,
  ExternalLink,
  RotateCcw,
  Search,
  Share2,
} from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace';
import { PWAInstallButton } from '../PWAInstallButton';

export function TopBarActions() {
  const {
    status,
    diffs,
    viewMode,
    xrayOpen,
    searchOpen,
    peerCount,
    setViewMode,
    setXRayOpen,
    setPaletteOpen,
    setSearchOpen,
    setBackupModalOpen,
    openShareModal,
    resetDemo,
  } = useWorkspaceStore();

  const dirtyCount =
    status.modified.length +
    status.added.length +
    status.deleted.length +
    status.conflicted.length;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div
        role="tablist"
        aria-label="Workspace view mode"
        className="flex items-center p-0.5 bg-indigo-950/50 border border-indigo-300/20 rounded-md"
      >
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'editor'}
          onClick={() => setViewMode('editor')}
          className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
            viewMode === 'editor'
              ? 'bg-gradient-to-r from-cyan-400/25 to-violet-400/25 text-white ring-1 ring-cyan-300/35 shadow-sm'
              : 'text-indigo-200 hover:text-white'
          }`}
        >
          Editor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={viewMode === 'diff'}
          onClick={() => setViewMode('diff')}
          className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
            viewMode === 'diff'
              ? 'bg-gradient-to-r from-cyan-400/25 to-violet-400/25 text-white ring-1 ring-cyan-300/35 shadow-sm'
              : 'text-indigo-200 hover:text-white'
          }`}
        >
          <span>Diff</span>
          {(dirtyCount > 0 || diffs.length > 0) && (
            <span className="font-mono text-[11px] font-semibold text-amber-300 tabular-nums">
              {Math.max(dirtyCount, diffs.length)}
            </span>
          )}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        aria-label="Search repository blobs"
        title="Full-text search across all blobs (⌘⇧F)"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
          searchOpen
            ? 'border-cyan-300/60 bg-cyan-400/20 text-cyan-100'
            : 'border-indigo-300/20 bg-indigo-500/12 text-cyan-200 hover:text-white hover:bg-cyan-400/18 hover:border-cyan-300/45'
        }`}
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden xl:inline">Search</span>
      </button>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Open command palette"
        title="Command Palette (⌘K)"
        className="hidden 2xl:inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md border border-indigo-300/18 bg-indigo-500/10 text-indigo-100 hover:text-white hover:bg-indigo-500/20 hover:border-indigo-300/35 transition-colors whitespace-nowrap shrink-0"
      >
        <Command className="w-3.5 h-3.5 text-violet-300" />
        <span className="font-mono text-[11px] text-indigo-200">⌘K</span>
      </button>

      <button
        type="button"
        onClick={() => setXRayOpen(!xrayOpen)}
        aria-expanded={xrayOpen}
        aria-label="Toggle X-Ray inspector"
        title="Toggle Merkle-DAG X-Ray inspector"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
          xrayOpen
            ? 'border-emerald-300/60 bg-emerald-400/20 text-emerald-100'
            : 'border-indigo-300/18 bg-indigo-500/10 text-emerald-200 hover:text-white hover:bg-emerald-400/18 hover:border-emerald-300/45'
        }`}
      >
        <Activity className="w-3.5 h-3.5" />
        <span className="hidden lg:inline">X-Ray</span>
      </button>

      <a
        href={typeof window !== 'undefined' ? window.location.href : '#'}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={
          peerCount > 0
            ? `Open twin tab (${peerCount} sibling tab synced)`
            : 'Open twin tab for multi-tab BroadcastChannel sync'
        }
        title={
          peerCount > 0
            ? `Open twin tab (${peerCount} sibling tab synced)`
            : 'Open twin tab for multi-tab BroadcastChannel sync'
        }
        className="hidden xl:inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md border border-indigo-300/18 bg-indigo-500/10 text-indigo-100 hover:text-white hover:bg-indigo-500/20 hover:border-indigo-300/35 transition-colors whitespace-nowrap shrink-0"
      >
        <ExternalLink className="w-3.5 h-3.5 text-indigo-300" />
        <span className="hidden 2xl:inline">Twin{peerCount > 0 ? ` (${peerCount})` : ''}</span>
      </a>

      <PWAInstallButton />

      <button
        type="button"
        onClick={() => setBackupModalOpen(true)}
        aria-label="Backup and import"
        title="Export .zip / .json backup or import files"
        className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md border border-indigo-300/20 bg-indigo-500/12 text-indigo-100 hover:text-white hover:bg-indigo-500/24 hover:border-cyan-300/40 transition-colors whitespace-nowrap shrink-0"
      >
        <Archive className="w-3.5 h-3.5 text-cyan-300" />
        <span className="hidden 2xl:inline">Backup</span>
      </button>

      <button
        type="button"
        onClick={() => void openShareModal()}
        aria-label="Share workspace via link"
        title="Share workspace via compressed link"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-violet-300/35 bg-violet-500/18 text-violet-100 hover:text-white hover:bg-violet-500/28 hover:border-violet-300/60 transition-colors whitespace-nowrap shrink-0"
      >
        <Share2 className="w-3.5 h-3.5 text-violet-300" />
        <span className="hidden xl:inline">Share</span>
      </button>

      <button
        type="button"
        onClick={() => void resetDemo()}
        aria-label="Reset demo repository"
        title="Reset demo repository"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-indigo-300/18 bg-indigo-500/10 text-indigo-100 hover:text-rose-200 hover:border-rose-400/50 hover:bg-rose-500/15 transition-colors whitespace-nowrap shrink-0"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span className="hidden 2xl:inline">Reset</span>
      </button>
    </div>
  );
}
