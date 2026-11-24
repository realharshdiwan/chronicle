import { AlertTriangle, Check, GitMerge, X } from "lucide-react";

import {
  findConflictMarkerPaths,
  parseConflictHunks,
} from "../../core/merge/conflictParser";
import type { ConflictResolution } from "../../core/merge/conflictParser";
import { diffTextLines } from "../../core/vcs/diff";
import type { WorkingFileDiff } from "../../core/types";
import type { PendingMergeState } from "../../core/vcs/Repository";

export interface DiffViewerProps {
  diffs: WorkingFileDiff[];
  workingFiles: Record<string, string>;
  pendingMerge?: PendingMergeState | null;
  busy?: boolean;
  readOnly?: boolean;
  onResolve?: (path: string, resolution: ConflictResolution) => void;
  onCommitMerge?: () => void;
  onAbortMerge?: () => void;
}

const STATUS_STYLES: Record<WorkingFileDiff["status"], string> = {
  ADDED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  MODIFIED: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  DELETED: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  UNMODIFIED: "border-white/10 bg-white/5 text-zinc-400",
};

function FileDiff({
  diff,
  conflicted,
  onResolve,
  readOnly,
}: {
  diff: WorkingFileDiff;
  conflicted: boolean;
  onResolve?: (path: string, resolution: ConflictResolution) => void;
  readOnly: boolean;
}) {
  const hunks = diffTextLines(diff.baseContent, diff.workingContent);
  const conflicts = conflicted
    ? parseConflictHunks(diff.workingContent)
    : [];

  return (
    <section className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#0b0e13]">
      <header className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="font-mono text-[11px] text-zinc-300">{diff.path}</span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] tracking-wide ${STATUS_STYLES[diff.status]}`}
        >
          {diff.status}
        </span>
        {conflicted && (
          <span className="inline-flex items-center gap-1 rounded border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 font-mono text-[9px] text-rose-300">
            <AlertTriangle className="size-3" aria-hidden />
            {conflicts.length || 1} conflict{conflicts.length === 1 ? "" : "s"}
          </span>
        )}
        {conflicted && !readOnly && onResolve && (
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => onResolve(diff.path, "ours")}
              className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-300 transition hover:border-emerald-400/40 hover:text-emerald-300"
            >
              Accept Ours
            </button>
            <button
              type="button"
              onClick={() => onResolve(diff.path, "theirs")}
              className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-300 transition hover:border-sky-400/40 hover:text-sky-300"
            >
              Accept Theirs
            </button>
            <button
              type="button"
              onClick={() => onResolve(diff.path, "both")}
              className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-zinc-300 transition hover:border-white/25"
            >
              Keep Both
            </button>
          </div>
        )}
      </header>

      <div className="max-h-80 overflow-auto px-1 py-1 font-mono text-[11px] leading-5">
        {hunks.map((hunk, hunkIndex) => {
          const lines = hunk.value.split("\n");
          if (lines[lines.length - 1] === "") lines.pop();

          return lines.map((line, lineIndex) => {
            const marker = hunk.added ? "+" : hunk.removed ? "−" : " ";
            const tone = hunk.added
              ? "bg-emerald-400/[0.07] text-emerald-200"
              : hunk.removed
                ? "bg-rose-400/[0.07] text-rose-200"
                : "text-zinc-500";
            return (
              <div
                key={`${hunkIndex}-${lineIndex}`}
                className={`grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 rounded px-2 ${tone}`}
              >
                <span className="select-none text-center opacity-50">
                  {marker}
                </span>
                <span className="whitespace-pre-wrap break-words">
                  {line || "\u00a0"}
                </span>
              </div>
            );
          });
        })}
      </div>
    </section>
  );
}

export function DiffViewer({
  diffs,
  workingFiles,
  pendingMerge = null,
  busy = false,
  readOnly = false,
  onResolve,
  onCommitMerge,
  onAbortMerge,
}: DiffViewerProps) {
  const changed = diffs.filter((diff) => diff.status !== "UNMODIFIED");
  const conflictPaths = new Set(findConflictMarkerPaths(workingFiles));
  const unresolved = changed.filter((diff) => conflictPaths.has(diff.path));

  if (changed.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <Check className="mx-auto size-6 text-emerald-400/70" aria-hidden />
          <p className="mt-3 text-sm text-zinc-400">Working tree is clean</p>
          <p className="mt-1 font-mono text-[11px] text-zinc-600">
            Edit a file or run a merge to see diffs here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto px-4 py-4">
      {pendingMerge && !readOnly && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2">
          <GitMerge className="size-4 text-amber-300/80" aria-hidden />
          <span className="text-xs text-amber-100/90">
            Merging{" "}
            <span className="font-mono text-amber-300">
              {pendingMerge.sourceBranch}
            </span>{" "}
            into{" "}
            <span className="font-mono text-amber-300">
              {pendingMerge.targetBranch}
            </span>
          </span>
          <span className="font-mono text-[10px] text-amber-200/60">
            {unresolved.length === 0
              ? "all conflicts resolved"
              : `${unresolved.length} file${unresolved.length === 1 ? "" : "s"} unresolved`}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={onAbortMerge}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 font-mono text-[10px] text-zinc-400 transition hover:border-rose-400/30 hover:text-rose-300 disabled:opacity-40"
            >
              <X className="size-3" aria-hidden />
              Abort
            </button>
            <button
              type="button"
              onClick={onCommitMerge}
              disabled={busy || unresolved.length > 0}
              className="inline-flex items-center gap-1 rounded border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 font-mono text-[10px] text-emerald-300 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="size-3" aria-hidden />
              Commit Merge
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {changed.map((diff) => (
          <FileDiff
            key={diff.path}
            diff={diff}
            conflicted={conflictPaths.has(diff.path)}
            onResolve={onResolve}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}
