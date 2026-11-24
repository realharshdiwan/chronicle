import { FileText, GitCompare, LoaderCircle, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { useWorkspaceStore } from "./state/workspace";
import { DiffViewer } from "./ui/editor/DiffViewer";
import { MarkdownEditor } from "./ui/editor/MarkdownEditor";
import { CommandPalette } from "./ui/layout/CommandPalette";
import { SidebarTree } from "./ui/layout/SidebarTree";
import { TopBar } from "./ui/layout/TopBar";
import { XRayDrawer } from "./ui/xray/XRayDrawer";

type WorkspaceView = "editor" | "diff";

export default function App() {
  const initialize = useWorkspaceStore((state) => state.initialize);
  const status = useWorkspaceStore((state) => state.status);
  const error = useWorkspaceStore((state) => state.error);
  const busy = useWorkspaceStore((state) => state.busy);
  const diffs = useWorkspaceStore((state) => state.diffs);
  const fileContents = useWorkspaceStore((state) => state.fileContents);
  const activePath = useWorkspaceStore((state) => state.activePath);
  const workingTree = useWorkspaceStore((state) => state.workingTree);
  const pendingMerge = useWorkspaceStore((state) => state.pendingMerge);
  const mergeOutcome = useWorkspaceStore((state) => state.mergeOutcome);
  const activeBranch = useWorkspaceStore((state) => state.activeBranch);
  const remoteBranch = useWorkspaceStore((state) => state.remoteBranch);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const newFile = useWorkspaceStore((state) => state.newFile);
  const deleteFile = useWorkspaceStore((state) => state.deleteFile);
  const resolveConflict = useWorkspaceStore((state) => state.resolveConflict);
  const completeMerge = useWorkspaceStore((state) => state.completeMerge);
  const abortMerge = useWorkspaceStore((state) => state.abortMerge);
  const [view, setView] = useState<WorkspaceView>("editor");

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    if (pendingMerge) setView("diff");
  }, [pendingMerge]);

  useEffect(() => {
    if (mergeOutcome?.status === "MERGED_CLEAN") setView("editor");
  }, [mergeOutcome]);

  if (status === "idle" || status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center bg-[#080a0d]">
        <div className="flex flex-col items-center gap-4">
          <span className="grid size-10 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 font-mono text-sm font-semibold text-emerald-300">
            C
          </span>
          <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            hydrating workspace from IndexedDB…
          </div>
        </div>
      </div>
    );
  }

  if (status === "error" && diffs.length === 0) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#080a0d] px-6">
        <div className="max-w-md rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-6">
          <h1 className="text-sm font-semibold text-rose-200">
            Workspace failed to initialize
          </h1>
          <p className="mt-2 font-mono text-[11px] leading-5 text-rose-200/70">
            {error}
          </p>
          <button
            type="button"
            onClick={() => void initialize()}
            className="mt-4 rounded-md border border-white/10 px-3 py-1.5 font-mono text-[10px] text-zinc-300 hover:border-white/20"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const changed = diffs.filter((diff) => diff.status !== "UNMODIFIED").length;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#080a0d] text-zinc-200">
      <TopBar />

      <div className="flex min-h-0 flex-1">
        <SidebarTree
          diffs={diffs}
          activePath={activePath}
          onSelect={(path) => {
            selectFile(path);
            setView("editor");
          }}
          onNewFile={() => {
            void newFile();
            setView("editor");
          }}
          onDeleteFile={(path) => void deleteFile(path)}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/[0.06] bg-[#090b0f] px-2">
            <button
              type="button"
              onClick={() => setView("editor")}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[10px] transition ${
                view === "editor"
                  ? "bg-white/[0.06] text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <FileText className="size-3.5" aria-hidden />
              Editor
            </button>
            <button
              type="button"
              onClick={() => setView("diff")}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[10px] transition ${
                view === "diff"
                  ? "bg-white/[0.06] text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <GitCompare className="size-3.5" aria-hidden />
              Diff
              {changed > 0 && (
                <span className="rounded border border-amber-400/25 bg-amber-400/10 px-1 text-[9px] text-amber-300">
                  {changed}
                </span>
              )}
            </button>

            <div className="ml-auto flex items-center gap-3 font-mono text-[9px] text-zinc-600">
              {remoteBranch && remoteBranch !== activeBranch && (
                <span className="text-sky-300/80">
                  twin · {remoteBranch}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <WifiOff className="size-3" aria-hidden />
                offline-ready
              </span>
            </div>
          </div>

          {error && (
            <div className="border-b border-rose-400/20 bg-rose-400/[0.06] px-3 py-1.5 font-mono text-[10px] text-rose-200/90">
              {error}
            </div>
          )}

          <div className="relative min-h-0 flex-1">
            {view === "editor" &&
              (workingTree && activePath ? (
                <MarkdownEditor
                  workingTree={workingTree}
                  path={activePath}
                />
              ) : (
                <div className="grid h-full place-items-center px-6 text-center">
                  <div>
                    <FileText
                      className="mx-auto size-6 text-zinc-600"
                      aria-hidden
                    />
                    <p className="mt-3 text-sm text-zinc-400">
                      No file selected
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-zinc-600">
                      Choose a file in the sidebar or create a new one.
                    </p>
                  </div>
                </div>
              ))}

            {view === "diff" && (
              <DiffViewer
                diffs={diffs}
                workingFiles={fileContents}
                pendingMerge={pendingMerge}
                busy={busy}
                onResolve={(path, resolution) =>
                  void resolveConflict(path, resolution)
                }
                onCommitMerge={() => void completeMerge()}
                onAbortMerge={() => void abortMerge()}
              />
            )}
          </div>
        </main>

        <XRayDrawer />
      </div>

      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-white/[0.06] bg-[#090b0f] px-3 font-mono text-[9px] text-zinc-600">
        <span>
          phase 5 / 5 · CRDT working tree + immutable Merkle-DAG
        </span>
        <span>
          {activeBranch ?? "detached"} · {diffs.length} files · {changed} changed
        </span>
      </footer>

      <CommandPalette
        onShowEditor={() => setView("editor")}
        onShowDiff={() => setView("diff")}
      />
    </div>
  );
}
