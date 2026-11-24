import {
  GitCommit,
  History,
  RefreshCw,
  SplitSquareHorizontal,
  X,
} from "lucide-react";

import { useWorkspaceStore } from "../../state/workspace";
import { DiffViewer } from "../editor/DiffViewer";
import { formatTimestamp, shortHash } from "../format";
import { CommitDagGraph } from "./CommitDagGraph";
import { StorageMetricsCard } from "./StorageMetricsCard";

export function XRayDrawer() {
  const open = useWorkspaceStore((state) => state.xrayOpen);
  const toggleXray = useWorkspaceStore((state) => state.toggleXray);
  const graphCommits = useWorkspaceStore((state) => state.graphCommits);
  const branches = useWorkspaceStore((state) => state.branches);
  const activeBranch = useWorkspaceStore((state) => state.activeBranch);
  const telemetry = useWorkspaceStore((state) => state.telemetry);
  const storageEstimate = useWorkspaceStore((state) => state.storageEstimate);
  const latencySamples = useWorkspaceStore((state) => state.latencySamples);
  const inspectedCommit = useWorkspaceStore((state) => state.inspectedCommit);
  const inspectedDiffs = useWorkspaceStore((state) => state.inspectedDiffs);
  const fileContents = useWorkspaceStore((state) => state.fileContents);
  const inspectCommit = useWorkspaceStore((state) => state.inspectCommit);
  const closeInspector = useWorkspaceStore((state) => state.closeInspector);
  const openTwinTab = useWorkspaceStore((state) => state.openTwinTab);
  const refresh = useWorkspaceStore((state) => state.refresh);

  if (!open) return null;

  return (
    <aside className="flex w-[24rem] shrink-0 flex-col border-l border-white/[0.06] bg-[#090b0f]">
      <div className="flex h-10 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-2">
          <History className="size-3.5 text-emerald-400/70" aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            Internals X-Ray
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refresh()}
            title="Refresh telemetry"
            aria-label="Refresh telemetry"
            className="grid size-6 place-items-center rounded text-zinc-600 transition hover:text-emerald-300"
          >
            <RefreshCw className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={toggleXray}
            title="Close X-Ray"
            aria-label="Close X-Ray"
            className="grid size-6 place-items-center rounded text-zinc-600 transition hover:text-zinc-300"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        <StorageMetricsCard
          telemetry={telemetry}
          estimate={storageEstimate}
          latencySamples={latencySamples}
        />

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              Merkle DAG
            </h3>
            <span className="font-mono text-[9px] text-zinc-600">
              {graphCommits.length} commits
            </span>
          </div>
          <CommitDagGraph
            commits={graphCommits}
            branches={branches}
            activeBranch={activeBranch}
            onSelect={(commit) => void inspectCommit(commit.hash)}
          />
          <p className="mt-1 font-mono text-[9px] text-zinc-600">
            Click a node to inspect its snapshot diff.
          </p>
        </section>

        {inspectedCommit && (
          <section className="rounded-lg border border-white/[0.07] bg-[#0b0e13]">
            <header className="flex items-start justify-between gap-2 border-b border-white/[0.06] px-3 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <GitCommit className="size-3 text-emerald-400/70" aria-hidden />
                  <span className="font-mono text-[10px] text-emerald-300/90">
                    {shortHash(inspectedCommit.hash)}
                  </span>
                  <span className="font-mono text-[9px] text-zinc-600">
                    {formatTimestamp(inspectedCommit.timestamp)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-200">
                  {inspectedCommit.message}
                </p>
                <p className="font-mono text-[9px] text-zinc-600">
                  {inspectedCommit.author}
                </p>
              </div>
              <button
                type="button"
                onClick={closeInspector}
                aria-label="Close commit inspector"
                className="grid size-5 shrink-0 place-items-center rounded text-zinc-600 hover:text-zinc-300"
              >
                <X className="size-3" aria-hidden />
              </button>
            </header>
            <div className="max-h-72 overflow-auto">
              <DiffViewer
                diffs={inspectedDiffs}
                workingFiles={fileContents}
                readOnly
              />
            </div>
          </section>
        )}

        <button
          type="button"
          onClick={openTwinTab}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-400/20 bg-sky-400/[0.05] px-3 py-2.5 font-mono text-[10px] text-sky-300/90 transition hover:border-sky-400/35 hover:bg-sky-400/[0.08]"
        >
          <SplitSquareHorizontal className="size-3.5" aria-hidden />
          Open Synced Twin Tab
        </button>

        <p className="pb-2 text-center font-mono text-[9px] leading-4 text-zinc-600">
          Yjs state vectors · BroadcastChannel relay · immutable CAS snapshots
        </p>
      </div>
    </aside>
  );
}
