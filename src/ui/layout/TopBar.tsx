import {
  Command,
  GitBranch,
  GitMerge,
  PanelRight,
  RotateCcw,
  SplitSquareHorizontal,
} from "lucide-react";

import { DEMO_FEATURE_BRANCH } from "../../core/seed/seedDemoRepo";
import { useWorkspaceStore } from "../../state/workspace";

export function TopBar() {
  const branches = useWorkspaceStore((state) => state.branches);
  const activeBranch = useWorkspaceStore((state) => state.activeBranch);
  const remoteBranch = useWorkspaceStore((state) => state.remoteBranch);
  const commitMessage = useWorkspaceStore((state) => state.commitMessage);
  const setCommitMessage = useWorkspaceStore((state) => state.setCommitMessage);
  const commit = useWorkspaceStore((state) => state.commit);
  const checkout = useWorkspaceStore((state) => state.checkout);
  const merge = useWorkspaceStore((state) => state.merge);
  const resetDemo = useWorkspaceStore((state) => state.resetDemo);
  const busy = useWorkspaceStore((state) => state.busy);
  const pendingMerge = useWorkspaceStore((state) => state.pendingMerge);
  const diffs = useWorkspaceStore((state) => state.diffs);
  const toggleXray = useWorkspaceStore((state) => state.toggleXray);
  const xrayOpen = useWorkspaceStore((state) => state.xrayOpen);
  const setPaletteOpen = useWorkspaceStore((state) => state.setPaletteOpen);
  const openTwinTab = useWorkspaceStore((state) => state.openTwinTab);

  const changed = diffs.filter((diff) => diff.status !== "UNMODIFIED").length;
  const canMerge = Boolean(branches[DEMO_FEATURE_BRANCH]) && !pendingMerge;

  function handleReset() {
    const confirmed =
      typeof window === "undefined" ||
      window.confirm(
        "Reset the demo workspace? Every local commit, branch, and uncommitted edit will be replaced by the original fixture.",
      );
    if (confirmed) void resetDemo();
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#090b0f] px-3">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-md border border-emerald-400/20 bg-emerald-400/10 font-mono text-xs font-semibold text-emerald-300">
          C
        </span>
        <span className="hidden text-sm font-semibold tracking-tight text-zinc-100 sm:inline">
          Chronicle
        </span>
      </div>

      <div className="mx-1 h-5 w-px bg-white/[0.07]" />

      <label className="flex items-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.02] px-2 py-1">
        <GitBranch className="size-3.5 text-zinc-500" aria-hidden />
        <select
          value={activeBranch ?? ""}
          onChange={(event) => void checkout(event.target.value)}
          disabled={busy || Boolean(pendingMerge)}
          aria-label="Active branch"
          className="max-w-40 bg-transparent font-mono text-[11px] text-zinc-300 outline-none disabled:opacity-50"
        >
          {Object.keys(branches)
            .sort()
            .map((branch) => (
              <option key={branch} value={branch} className="bg-[#0b0e13]">
                {branch}
              </option>
            ))}
        </select>
      </label>

      {remoteBranch && remoteBranch !== activeBranch && (
        <span className="hidden items-center gap-1 rounded border border-sky-400/20 bg-sky-400/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-sky-300/80 md:inline-flex">
          twin on {remoteBranch}
        </span>
      )}

      <form
        className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <input
          id="commit-message"
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder={
            changed === 0 ? "No changes to commit" : `Commit ${changed} file${changed === 1 ? "" : "s"}…`
          }
          disabled={busy}
          className="h-8 w-full max-w-72 rounded-md border border-white/[0.07] bg-black/20 px-2.5 font-mono text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-emerald-400/30 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || changed === 0 || commitMessage.trim() === ""}
          className="h-8 shrink-0 rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2.5 font-mono text-[10px] text-emerald-300 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Commit
        </button>
      </form>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void merge(DEMO_FEATURE_BRANCH)}
          disabled={busy || !canMerge}
          title={`Merge ${DEMO_FEATURE_BRANCH} into HEAD`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.07] px-2 font-mono text-[10px] text-zinc-400 transition hover:border-amber-400/30 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <GitMerge className="size-3.5" aria-hidden />
          <span className="hidden lg:inline">Merge feature</span>
        </button>

        <button
          type="button"
          onClick={handleReset}
          disabled={busy}
          title="Reset demo workspace"
          aria-label="Reset demo workspace"
          className="grid size-8 place-items-center rounded-md border border-white/[0.07] text-zinc-500 transition hover:border-rose-400/30 hover:text-rose-300 disabled:opacity-40"
        >
          <RotateCcw className="size-3.5" aria-hidden />
        </button>

        <button
          type="button"
          onClick={openTwinTab}
          title="Open synced twin tab"
          aria-label="Open synced twin tab"
          className="grid size-8 place-items-center rounded-md border border-white/[0.07] text-zinc-500 transition hover:border-sky-400/30 hover:text-sky-300"
        >
          <SplitSquareHorizontal className="size-3.5" aria-hidden />
        </button>

        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title="Command palette (Cmd+K)"
          aria-label="Open command palette"
          className="grid size-8 place-items-center rounded-md border border-white/[0.07] text-zinc-500 transition hover:border-white/20 hover:text-zinc-200"
        >
          <Command className="size-3.5" aria-hidden />
        </button>

        <button
          type="button"
          onClick={toggleXray}
          aria-pressed={xrayOpen}
          title="Toggle Internals X-Ray"
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2 font-mono text-[10px] transition ${
            xrayOpen
              ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
              : "border-white/[0.07] text-zinc-500 hover:text-zinc-200"
          }`}
        >
          <PanelRight className="size-3.5" aria-hidden />
          <span className="hidden xl:inline">X-Ray</span>
        </button>
      </div>
    </header>
  );
}
