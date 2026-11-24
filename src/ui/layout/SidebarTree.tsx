import { FilePlus2, FileText, Trash2 } from "lucide-react";

import type { WorkingFileDiff } from "../../core/types";

export interface SidebarTreeProps {
  diffs: WorkingFileDiff[];
  activePath: string | null;
  onSelect(path: string): void;
  onNewFile(): void;
  onDeleteFile(path: string): void;
}

const BADGE: Record<WorkingFileDiff["status"], string> = {
  ADDED: "text-emerald-300 border-emerald-400/30 bg-emerald-400/10",
  MODIFIED: "text-amber-300 border-amber-400/30 bg-amber-400/10",
  DELETED: "text-rose-300 border-rose-400/30 bg-rose-400/10",
  UNMODIFIED: "text-zinc-600 border-transparent bg-transparent",
};

const BADGE_LABEL: Record<WorkingFileDiff["status"], string> = {
  ADDED: "A",
  MODIFIED: "M",
  DELETED: "D",
  UNMODIFIED: "",
};

function splitPath(path: string): { directory: string; name: string } {
  const index = path.lastIndexOf("/");
  if (index === -1) return { directory: "", name: path };
  return {
    directory: path.slice(0, index + 1),
    name: path.slice(index + 1),
  };
}

export function SidebarTree({
  diffs,
  activePath,
  onSelect,
  onNewFile,
  onDeleteFile,
}: SidebarTreeProps) {
  const sorted = [...diffs].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const changed = sorted.filter((diff) => diff.status !== "UNMODIFIED").length;

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-[#090b0f]">
      <div className="flex h-10 items-center justify-between border-b border-white/[0.06] px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            Files
          </span>
          <span className="rounded border border-white/10 px-1 font-mono text-[9px] text-zinc-500">
            {sorted.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onNewFile}
          title="New file"
          aria-label="New file"
          className="grid size-6 place-items-center rounded border border-transparent text-zinc-500 transition hover:border-white/10 hover:bg-white/[0.03] hover:text-emerald-300"
        >
          <FilePlus2 className="size-3.5" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {sorted.length === 0 && (
          <p className="px-2 py-4 text-xs leading-5 text-zinc-600">
            No files yet. Create one to begin.
          </p>
        )}

        {sorted.map((diff) => {
          const { directory, name } = splitPath(diff.path);
          const active = diff.path === activePath;
          const deleted = diff.status === "DELETED";

          return (
            <div
              key={diff.path}
              className={`group flex items-center gap-1 rounded-md pr-1 transition ${
                active
                  ? "bg-white/[0.06] text-zinc-100"
                  : "text-zinc-400 hover:bg-white/[0.03]"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(diff.path)}
                disabled={deleted}
                className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileText
                  className={`size-3.5 shrink-0 ${active ? "text-emerald-300" : "text-zinc-600"}`}
                  aria-hidden
                />
                <span className="min-w-0 truncate font-mono text-[11px]">
                  {directory && (
                    <span className="text-zinc-600">{directory}</span>
                  )}
                  <span className={deleted ? "line-through" : ""}>{name}</span>
                </span>
                <span
                  className={`ml-auto rounded border px-1 font-mono text-[9px] ${BADGE[diff.status]}`}
                >
                  {BADGE_LABEL[diff.status]}
                </span>
              </button>

              {!deleted && (
                <button
                  type="button"
                  onClick={() => onDeleteFile(diff.path)}
                  title={`Delete ${diff.path}`}
                  aria-label={`Delete ${diff.path}`}
                  className="grid size-5 shrink-0 place-items-center rounded text-zinc-600 opacity-0 transition hover:bg-rose-400/10 hover:text-rose-300 group-hover:opacity-100"
                >
                  <Trash2 className="size-3" aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-white/[0.06] px-3 py-2 font-mono text-[10px] text-zinc-600">
        <div className="flex items-center justify-between">
          <span>working tree</span>
          <span className={changed === 0 ? "text-emerald-400/70" : "text-amber-300/80"}>
            {changed === 0 ? "clean" : `${changed} changed`}
          </span>
        </div>
      </div>
    </aside>
  );
}
