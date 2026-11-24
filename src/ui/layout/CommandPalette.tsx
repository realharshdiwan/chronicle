import {
  Command,
  FilePlus2,
  GitBranch,
  GitCommit,
  GitMerge,
  PanelRight,
  RotateCcw,
  SplitSquareHorizontal,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DEMO_FEATURE_BRANCH } from "../../core/seed/seedDemoRepo";
import { useWorkspaceStore } from "../../state/workspace";

export interface CommandPaletteProps {
  onShowEditor(): void;
  onShowDiff(): void;
}

interface PaletteCommand {
  id: string;
  label: string;
  hint: string;
  icon: typeof Command;
  run: () => void;
}

export function CommandPalette({
  onShowEditor,
  onShowDiff,
}: CommandPaletteProps) {
  const open = useWorkspaceStore((state) => state.paletteOpen);
  const setPaletteOpen = useWorkspaceStore((state) => state.setPaletteOpen);
  const branches = useWorkspaceStore((state) => state.branches);
  const activeBranch = useWorkspaceStore((state) => state.activeBranch);
  const commit = useWorkspaceStore((state) => state.commit);
  const checkout = useWorkspaceStore((state) => state.checkout);
  const createBranch = useWorkspaceStore((state) => state.createBranch);
  const merge = useWorkspaceStore((state) => state.merge);
  const resetDemo = useWorkspaceStore((state) => state.resetDemo);
  const newFile = useWorkspaceStore((state) => state.newFile);
  const toggleXray = useWorkspaceStore((state) => state.toggleXray);
  const openTwinTab = useWorkspaceStore((state) => state.openTwinTab);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(!useWorkspaceStore.getState().paletteOpen);
      } else if (event.key === "Escape") {
        setPaletteOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setPaletteOpen]);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      {
        id: "commit",
        label: "Commit working tree",
        hint: "Git semantics",
        icon: GitCommit,
        run: () => void commit(),
      },
      {
        id: "new-file",
        label: "New file",
        hint: "Working tree",
        icon: FilePlus2,
        run: () => void newFile(),
      },
      {
        id: "new-branch",
        label: "New branch…",
        hint: "From HEAD",
        icon: GitBranch,
        run: () => {
          if (typeof window === "undefined") return;
          const name = window.prompt("New branch name");
          if (name) void createBranch(name);
        },
      },
      {
        id: "merge-feature",
        label: `Merge ${DEMO_FEATURE_BRANCH}`,
        hint: "LCA three-way merge",
        icon: GitMerge,
        run: () => void merge(DEMO_FEATURE_BRANCH),
      },
      {
        id: "show-editor",
        label: "Show editor",
        hint: "CodeMirror + Y.Text",
        icon: Command,
        run: onShowEditor,
      },
      {
        id: "show-diff",
        label: "Show working diff",
        hint: "Unified diff viewer",
        icon: GitMerge,
        run: onShowDiff,
      },
      {
        id: "toggle-xray",
        label: "Toggle Internals X-Ray",
        hint: "CAS + DAG telemetry",
        icon: PanelRight,
        run: toggleXray,
      },
      {
        id: "twin-tab",
        label: "Open synced twin tab",
        hint: "BroadcastChannel convergence",
        icon: SplitSquareHorizontal,
        run: openTwinTab,
      },
      {
        id: "reset-demo",
        label: "Reset demo workspace",
        hint: "Clear IndexedDB and reseed",
        icon: RotateCcw,
        run: () => {
          if (
            typeof window === "undefined" ||
            window.confirm(
              "Reset the demo workspace? Local commits and edits will be replaced by the original fixture.",
            )
          ) {
            void resetDemo();
          }
        },
      },
    ];

    for (const branch of Object.keys(branches).sort()) {
      if (branch === activeBranch) continue;
      list.push({
        id: `checkout-${branch}`,
        label: `Checkout ${branch}`,
        hint: "Branch switch",
        icon: GitBranch,
        run: () => void checkout(branch),
      });
    }

    return list;
  }, [
    activeBranch,
    branches,
    checkout,
    commit,
    createBranch,
    merge,
    newFile,
    onShowDiff,
    onShowEditor,
    openTwinTab,
    resetDemo,
    toggleXray,
  ]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized === "") return commands;
    return commands.filter((command) =>
      `${command.label} ${command.hint}`.toLowerCase().includes(normalized),
    );
  }, [commands, query]);

  if (!open) return null;

  function run(command: PaletteCommand) {
    setPaletteOpen(false);
    command.run();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setPaletteOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-[#0b0e13] shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-3">
          <Command className="size-3.5 text-emerald-400/70" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const first = filtered[0];
                if (first) run(first);
              }
            }}
            placeholder="Run a command…"
            className="h-11 flex-1 bg-transparent font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          <button
            type="button"
            onClick={() => setPaletteOpen(false)}
            aria-label="Close command palette"
            className="grid size-6 place-items-center rounded text-zinc-600 hover:text-zinc-300"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        <div className="max-h-80 overflow-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center font-mono text-[11px] text-zinc-600">
              No matching commands
            </p>
          )}

          {filtered.map((command) => {
            const Icon = command.icon;
            return (
              <button
                key={command.id}
                type="button"
                onClick={() => run(command)}
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition hover:bg-white/[0.05]"
              >
                <Icon className="size-3.5 text-zinc-500" aria-hidden />
                <span className="text-xs text-zinc-300">{command.label}</span>
                <span className="ml-auto font-mono text-[9px] text-zinc-600">
                  {command.hint}
                </span>
              </button>
            );
          })}
        </div>

        <div className="border-t border-white/[0.06] px-3 py-1.5 font-mono text-[9px] text-zinc-600">
          Enter to run · Esc to close · ⌘K to toggle
        </div>
      </div>
    </div>
  );
}
