import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  GitMerge,
  Pencil,
  X,
} from 'lucide-react';
import {
  hasConflictMarkers,
  parseConflictRegions,
} from '../core/vcs/merge/conflictParser';
import { useWorkspaceStore } from '../state/workspace';

export function DiffViewer() {
  const {
    files,
    diffs,
    pendingMerge,
    refs,
    resolveConflict,
    completeMerge,
    abortMerge,
    mergeBranch,
    setActiveFile,
    setViewMode,
  } = useWorkspaceStore();

  const [mergeMessage, setMergeMessage] = useState('');

  const conflictedFiles = Object.entries(files)
    .filter(([, content]) => hasConflictMarkers(content))
    .map(([path]) => path)
    .sort();

  const currentBranch =
    refs?.head.type === 'branch' ? refs.head.branch : 'HEAD';
  const branchNames = Object.keys(refs?.branches ?? {}).filter(
    (b) => b !== currentBranch
  );

  if (diffs.length === 0 && !pendingMerge && conflictedFiles.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <h2 className="font-display text-lg font-semibold text-white">
          Working tree is clean
        </h2>
        <p className="mt-1.5 text-sm text-indigo-200 max-w-md">
          No uncommitted changes relative to{' '}
          <span className="font-mono text-cyan-200">{currentBranch}</span>. Edit
          any file in the editor or merge a branch to inspect a 3-way diff.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setViewMode('editor')}
            className="px-4 py-2 text-xs font-medium rounded-md border border-indigo-300/20 bg-indigo-500/12 text-indigo-50 hover:bg-indigo-500/22 transition-colors whitespace-nowrap shrink-0"
          >
            Back to Editor
          </button>
          {branchNames.includes('feat/sync-protocol') && (
            <button
              type="button"
              onClick={() => void mergeBranch('feat/sync-protocol')}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-md bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 hover:from-cyan-300 hover:to-violet-300 transition-colors whitespace-nowrap shrink-0"
            >
              <GitMerge className="w-3.5 h-3.5" />
              Merge feat/sync-protocol
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">
      {pendingMerge && (
        <section
          aria-label="Merge resolution controls"
          className="glass-panel border border-indigo-300/20 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <AlertTriangle
                className={`w-4 h-4 shrink-0 ${
                  conflictedFiles.length > 0 ? 'text-amber-300' : 'text-emerald-300'
                }`}
              />
              <span>
                Merging{' '}
                <span className="font-mono text-cyan-300">
                  {pendingMerge.targetBranch}
                </span>{' '}
                into{' '}
                <span className="font-mono text-violet-200">{currentBranch}</span>
              </span>
            </div>
            <p className="text-xs text-indigo-200">
              {conflictedFiles.length > 0
                ? `${conflictedFiles.length} file with unresolved conflict markers. Choose Ours, Theirs, or Both below.`
                : 'All conflicts resolved. Commit the 2-parent merge snapshot to complete.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={mergeMessage}
              onChange={(e) => setMergeMessage(e.target.value)}
              placeholder={`Merge branch '${pendingMerge.targetBranch}' into ${currentBranch}`}
              aria-label="Merge commit message"
              className="bg-indigo-950/75 border border-indigo-300/25 rounded-md px-3 py-1.5 text-xs text-white placeholder:text-indigo-200/50 focus:outline-none focus:border-cyan-300 w-64 max-w-full"
            />
            <button
              type="button"
              onClick={() => void abortMerge()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-indigo-300/20 bg-indigo-500/12 text-indigo-100 hover:text-white hover:border-indigo-300/40 transition-colors whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              Abort Merge
            </button>
            <button
              type="button"
              disabled={conflictedFiles.length > 0}
              onClick={() => void completeMerge(mergeMessage)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md bg-emerald-400 text-slate-950 hover:bg-emerald-300 disabled:bg-indigo-500/15 disabled:text-indigo-200/50 transition-colors whitespace-nowrap shrink-0"
            >
              <Check className="w-3.5 h-3.5" />
              Commit Merge
            </button>
          </div>
        </section>
      )}

      {conflictedFiles.map((path) => {
        const content = files[path] ?? '';
        const regions = parseConflictRegions(content);
        return (
          <section
            key={`conflict-${path}`}
            className="glass-panel border border-rose-400/50 rounded-lg overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-indigo-300/14 bg-indigo-950/35 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs font-mono text-white">
                <span>{path}</span>
                <span className="text-indigo-400" aria-hidden="true">
                  ·
                </span>
                <span className="text-rose-300 font-sans font-medium">
                  {regions.length} conflict{regions.length === 1 ? '' : 's'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveFile(path);
                  setViewMode('editor');
                }}
                className="inline-flex items-center gap-1 text-xs text-indigo-100 hover:text-white transition-colors"
              >
                <Pencil className="w-3 h-3" />
                Edit Raw
              </button>
            </div>

            <div className="p-4 space-y-4">
              {regions.map((region) => (
                <div
                  key={`${path}-region-${region.index}`}
                  className="border border-indigo-300/18 rounded-md overflow-hidden bg-[#0A0D1E]/85"
                >
                  <div className="px-3 py-2 border-b border-indigo-300/14 bg-indigo-950/35 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-mono text-indigo-200 tabular-nums">
                      Conflict #{region.index + 1} (lines {region.startLine + 1}–
                      {region.endLine + 1})
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => resolveConflict(path, region.index, 'ours')}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-cyan-400/18 text-cyan-200 border border-cyan-300/40 hover:bg-cyan-400/28 transition-colors whitespace-nowrap shrink-0"
                      >
                        Accept Ours
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveConflict(path, region.index, 'theirs')}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-emerald-400/18 text-emerald-200 border border-emerald-300/40 hover:bg-emerald-400/28 transition-colors whitespace-nowrap shrink-0"
                      >
                        Accept Theirs
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveConflict(path, region.index, 'both')}
                        className="px-2.5 py-1 text-xs font-medium rounded bg-violet-400/18 text-violet-100 border border-violet-300/35 hover:bg-violet-400/28 transition-colors whitespace-nowrap shrink-0"
                      >
                        Accept Both
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-indigo-300/14">
                    <div className="p-3 bg-cyan-500/[0.08]">
                      <div className="text-[11px] font-mono text-cyan-300 mb-1.5">
                        Current ({region.oursLabel || currentBranch})
                      </div>
                      <pre className="text-xs font-mono text-slate-100 whitespace-pre-wrap break-words leading-relaxed">
                        {region.oursLines.join('\n') || '(empty)'}
                      </pre>
                    </div>
                    <div className="p-3 bg-emerald-500/[0.08]">
                      <div className="text-[11px] font-mono text-emerald-300 mb-1.5">
                        Incoming ({region.theirsLabel})
                      </div>
                      <pre className="text-xs font-mono text-slate-100 whitespace-pre-wrap break-words leading-relaxed">
                        {region.theirsLines.join('\n') || '(empty)'}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {diffs.map((fileDiff) => {
        const totalDelta = Math.max(1, fileDiff.additions + fileDiff.deletions);
        const addPct = (fileDiff.additions / totalDelta) * 100;
        const delPct = (fileDiff.deletions / totalDelta) * 100;

        return (
          <section
            key={fileDiff.path}
            className="glass-surface border border-indigo-300/18 rounded-lg overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-indigo-300/14 bg-indigo-950/35 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 min-w-0 text-xs">
                <span className="font-mono text-white truncate">
                  {fileDiff.path}
                </span>
                <span className="text-indigo-400" aria-hidden="true">
                  ·
                </span>
                <span
                  className={`capitalize font-medium ${
                    fileDiff.status === 'added'
                      ? 'text-emerald-300'
                      : fileDiff.status === 'deleted'
                        ? 'text-rose-300'
                        : 'text-amber-300'
                  }`}
                >
                  {fileDiff.status}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono tabular-nums shrink-0">
                <div className="hidden sm:flex items-center gap-1.5">
                  <span className="text-emerald-300">+{fileDiff.additions}</span>
                  <span className="text-rose-300">-{fileDiff.deletions}</span>
                  <span className="w-12 h-1.5 rounded-full bg-indigo-950 overflow-hidden flex">
                    <span
                      className="h-full bg-emerald-400"
                      style={{ width: `${addPct}%` }}
                    />
                    <span
                      className="h-full bg-rose-400"
                      style={{ width: `${delPct}%` }}
                    />
                  </span>
                </div>
                {fileDiff.status !== 'deleted' && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFile(fileDiff.path);
                      setViewMode('editor');
                    }}
                    className="font-sans text-cyan-200 hover:text-white pl-2 border-l border-indigo-300/20 transition-colors"
                  >
                    Open
                  </button>
                )}
              </div>
            </div>

            <div className="overflow-x-auto bg-[#090B19]/85 font-mono text-xs leading-6">
              {fileDiff.hunks.map((hunk, hunkIdx) => (
                <div key={`${fileDiff.path}-hunk-${hunkIdx}`}>
                  <div className="px-4 py-1 bg-indigo-500/[0.10] text-violet-200 border-y border-indigo-300/14 select-none tabular-nums">
                    @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
                    {hunk.newLines} @@
                  </div>
                  <div>
                    {hunk.lines.map((line, lineIdx) => {
                      const rowCls =
                        line.type === 'add'
                          ? 'bg-emerald-500/16 text-emerald-100'
                          : line.type === 'remove'
                            ? 'bg-rose-500/16 text-rose-100'
                            : 'text-slate-200';
                      const sigil =
                        line.type === 'add'
                          ? '+'
                          : line.type === 'remove'
                            ? '-'
                            : ' ';
                      return (
                        <div
                          key={`${hunkIdx}-${lineIdx}`}
                          className={`flex min-w-max ${rowCls}`}
                        >
                          <span className="w-11 px-2 text-right text-indigo-300/65 select-none shrink-0 tabular-nums">
                            {line.oldLineNo ?? ''}
                          </span>
                          <span className="w-11 px-2 text-right text-indigo-300/65 select-none border-r border-indigo-300/14 shrink-0 tabular-nums">
                            {line.newLineNo ?? ''}
                          </span>
                          <span className="w-6 text-center select-none shrink-0 opacity-80">
                            {sigil}
                          </span>
                          <span className="pr-4 whitespace-pre">{line.content}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
