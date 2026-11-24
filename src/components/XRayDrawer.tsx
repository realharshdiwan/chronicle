import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace';
import { CommitDagGraph } from './CommitDagGraph';
import { StorageMetricsCard } from './StorageMetricsCard';

export function XRayDrawer() {
  const {
    xrayOpen,
    setXRayOpen,
    telemetry,
    quota,
    commits,
    refs,
    selectedCommitHash,
    selectedCommitDiffs,
    selectCommitForInspect,
  } = useWorkspaceStore();

  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  if (!xrayOpen) return null;

  const selectedCommit = commits.find((c) => c.hash === selectedCommitHash);

  return (
    <div
      role="dialog"
      aria-label="X-Ray CAS and Merkle-DAG Inspector"
      className="fixed inset-y-0 right-0 z-40 w-[500px] max-w-full glass-drawer border-l border-indigo-300/25 flex flex-col"
    >
      <div className="h-14 px-5 border-b border-indigo-300/18 bg-indigo-500/[0.08] flex items-center justify-between shrink-0">
        <div>
          <h2 className="font-display text-sm font-semibold text-white">
            X-Ray Inspector
          </h2>
          <p className="text-[11px] text-indigo-200/85">
            Live IndexedDB CAS telemetry and Merkle-DAG snapshot history
          </p>
        </div>
        <button
          type="button"
          onClick={() => setXRayOpen(false)}
          aria-label="Close X-Ray drawer"
          className="p-1.5 rounded-md text-indigo-200 hover:text-white hover:bg-indigo-400/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <StorageMetricsCard telemetry={telemetry} quota={quota} />

        <CommitDagGraph
          commits={commits}
          refs={refs}
          selectedCommitHash={selectedCommitHash}
          onSelectCommit={(hash) => {
            setExpandedFile(null);
            void selectCommitForInspect(hash);
          }}
        />

        {selectedCommit && (
          <section
            aria-label="Commit snapshot details"
            className="glass-surface border border-indigo-300/20 rounded-lg p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-xs text-cyan-300 break-all">
                  {selectedCommit.hash}
                </div>
                <div className="mt-1 text-sm font-medium text-white">
                  {selectedCommit.message}
                </div>
                <div className="mt-0.5 text-[11px] text-indigo-200/85 font-mono tabular-nums">
                  Tree: {selectedCommit.treeHash.slice(0, 12)} · Parents:{' '}
                  {selectedCommit.parentHashes.length === 0
                    ? 'root'
                    : selectedCommit.parentHashes
                        .map((p) => p.slice(0, 7))
                        .join(', ')}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void selectCommitForInspect(null)}
                aria-label="Clear selected commit"
                className="p-1 rounded text-indigo-200 hover:text-white hover:bg-indigo-400/20 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-2 pt-2 border-t border-indigo-300/15">
              <div className="text-[11px] font-medium text-indigo-100">
                Snapshot Diff vs Parent ({selectedCommitDiffs.length} files)
              </div>
              {selectedCommitDiffs.length === 0 ? (
                <div className="text-xs text-indigo-200/70">
                  No file changes against primary parent.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {selectedCommitDiffs.map((d) => {
                    const isOpen = expandedFile === d.path;
                    return (
                      <div
                        key={d.path}
                        className="border border-indigo-300/18 rounded bg-[#090B19]/75 backdrop-blur-sm overflow-hidden text-xs"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedFile(isOpen ? null : d.path)
                          }
                          className="w-full px-2.5 py-2 flex items-center justify-between font-mono hover:bg-indigo-400/12 transition-colors"
                        >
                          <span className="flex items-center gap-1.5 text-indigo-50 truncate">
                            {isOpen ? (
                              <ChevronDown className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                            )}
                            <span className="truncate">{d.path}</span>
                          </span>
                          <span className="tabular-nums shrink-0 ml-2">
                            <span className="text-emerald-300">
                              +{d.additions}
                            </span>{' '}
                            <span className="text-rose-300">
                              -{d.deletions}
                            </span>
                          </span>
                        </button>

                        {isOpen && (
                          <div className="border-t border-indigo-300/14 max-h-44 overflow-auto font-mono text-[11px] leading-5">
                            {d.hunks.map((hunk, hi) =>
                              hunk.lines.map((line, li) => (
                                <div
                                  key={`${hi}-${li}`}
                                  className={`px-2.5 whitespace-pre ${
                                    line.type === 'add'
                                      ? 'bg-emerald-500/16 text-emerald-100'
                                      : line.type === 'remove'
                                        ? 'bg-rose-500/16 text-rose-100'
                                        : 'text-slate-200'
                                  }`}
                                >
                                  {line.type === 'add'
                                    ? '+ '
                                    : line.type === 'remove'
                                      ? '- '
                                      : '  '}
                                  {line.content}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
