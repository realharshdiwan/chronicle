import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Archive,
  FilePlus2,
  FolderGit2,
  GitBranch,
  GitCompare,
  GitMerge,
  RotateCcw,
  Search,
  Share2,
  Trash2,
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace';

interface CommandItem {
  id: string;
  label: string;
  detail?: string;
  icon: typeof Activity;
  run: () => void;
}

export function CommandPalette() {
  const {
    paletteOpen,
    refs,
    xrayOpen,
    setPaletteOpen,
    setSearchOpen,
    setWorkspaceModalOpen,
    setBackupModalOpen,
    setViewMode,
    setXRayOpen,
    checkoutTarget,
    mergeBranch,
    deleteBranch,
    createFile,
    openShareModal,
    resetDemo,
  } = useWorkspaceStore();

  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const currentBranch =
    refs?.head.type === 'branch' ? refs.head.branch : null;
  const branches = Object.keys(refs?.branches ?? {}).sort();

  const commands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [
      {
        id: 'search-blobs',
        label: 'Search All Repository Blobs (⌘⇧F)',
        detail: 'Full-text inverted index search in IndexedDB across all commits & live files',
        icon: Search,
        run: () => setSearchOpen(true),
      },
      {
        id: 'view-editor',
        label: 'Switch to Editor View',
        detail: 'Markdown CRDT Editor',
        icon: FilePlus2,
        run: () => setViewMode('editor'),
      },
      {
        id: 'view-diff',
        label: 'Switch to Diff & Merge View',
        detail: 'Inspect uncommitted changes or resolve conflicts',
        icon: GitCompare,
        run: () => setViewMode('diff'),
      },
      {
        id: 'toggle-xray',
        label: xrayOpen ? 'Close X-Ray Inspector' : 'Open X-Ray Inspector',
        detail: 'CAS telemetry & Merkle-DAG graph',
        icon: Activity,
        run: () => setXRayOpen(!xrayOpen),
      },
      {
        id: 'new-file',
        label: 'Create Quick Note (notes/scratchpad.md)',
        detail: 'Adds a new file to working tree',
        icon: FilePlus2,
        run: () =>
          createFile(
            `notes/note-${Date.now().toString().slice(-4)}.md`,
            '# Scratchpad\n\n'
          ),
      },
    ];

    for (const branch of branches) {
      if (branch !== currentBranch) {
        list.push({
          id: `checkout-${branch}`,
          label: `Checkout branch: ${branch}`,
          detail: 'Switch working tree',
          icon: GitBranch,
          run: () => void checkoutTarget(branch),
        });
        list.push({
          id: `merge-${branch}`,
          label: `Merge ${branch} into ${currentBranch ?? 'HEAD'}`,
          detail: '3-way LCA merge',
          icon: GitMerge,
          run: () => void mergeBranch(branch),
        });
        list.push({
          id: `delete-branch-${branch}`,
          label: `Delete branch: ${branch}`,
          detail: 'Remove branch pointer (safe-guards unmerged commits)',
          icon: Trash2,
          run: () =>
            void deleteBranch(branch, false).then((res) => {
              if (res === 'unmerged') {
                useWorkspaceStore.getState().setNotice({
                  type: 'error',
                  message: `Branch "${branch}" has unmerged commits — use Force Delete in the Top Bar.`,
                });
              }
            }),
        });
      }
    }

    list.push({
      id: 'workspaces-settings',
      label: 'Workspaces & Author Settings',
      detail: 'Switch isolated notebooks, create blank workspace, or edit commit author',
      icon: FolderGit2,
      run: () => setWorkspaceModalOpen(true),
    });

    list.push({
      id: 'backup-import',
      label: 'Backup & Import (.zip / .json / Markdown)',
      detail: 'Export full archive or drag-and-drop files into workspace',
      icon: Archive,
      run: () => setBackupModalOpen(true),
    });

    list.push({
      id: 'share-link',
      label: 'Share Workspace via Link',
      detail: 'Compress sanitized repository state into a direct URL',
      icon: Share2,
      run: () => void openShareModal(),
    });

    list.push({
      id: 'reset-demo',
      label: 'Reset Workspace',
      detail: 'Clears IndexedDB and resets current workspace',
      icon: RotateCcw,
      run: () => void resetDemo(),
    });

    return list;
  }, [
    branches,
    currentBranch,
    xrayOpen,
    setSearchOpen,
    setWorkspaceModalOpen,
    setBackupModalOpen,
    setViewMode,
    setXRayOpen,
    createFile,
    checkoutTarget,
    mergeBranch,
    deleteBranch,
    openShareModal,
    resetDemo,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.detail && c.detail.toLowerCase().includes(q))
    );
  }, [commands, query]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query, paletteOpen]);

  if (!paletteOpen) return null;

  const execute = (item: CommandItem) => {
    setPaletteOpen(false);
    setQuery('');
    item.run();
  };

  return (
    <div
      role="dialog"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4 bg-[#050611]/70 backdrop-blur-md"
      onClick={() => setPaletteOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-indigo-300/25 bg-[#121530]/92 backdrop-blur-2xl shadow-[0_24px_70px_rgba(4,6,22,0.82)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-indigo-300/15 bg-indigo-950/35">
          <Search className="w-4 h-4 text-violet-300 shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setPaletteOpen(false);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && filtered[selectedIdx]) {
                e.preventDefault();
                execute(filtered[selectedIdx]);
              }
            }}
            placeholder="Type a command or branch name..."
            aria-label="Filter commands"
            autoFocus
            className="w-full bg-transparent text-sm text-white placeholder:text-indigo-200/55 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setPaletteOpen(false)}
            className="text-[11px] font-mono text-indigo-200 hover:text-white px-1.5 py-0.5 rounded border border-indigo-300/25 bg-indigo-500/15"
          >
            ESC
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-indigo-200/70">
              No matching commands.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const active = idx === selectedIdx;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => execute(item)}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  className={`w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left transition-colors ${
                    active
                      ? 'bg-gradient-to-r from-cyan-400/20 to-violet-400/20 text-white'
                      : 'text-indigo-100'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        active ? 'text-cyan-300' : 'text-indigo-300/75'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">
                        {item.label}
                      </div>
                      {item.detail && (
                        <div className="text-[11px] text-indigo-200/80 truncate">
                          {item.detail}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
