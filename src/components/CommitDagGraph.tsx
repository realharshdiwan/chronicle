import type { CommitObject, RefState } from '../core/types';

interface CommitDagGraphProps {
  commits: CommitObject[];
  refs: RefState | null;
  selectedCommitHash: string | null;
  onSelectCommit: (hash: string) => void;
}

interface PositionedNode {
  commit: CommitObject;
  lane: number;
  row: number;
}

export function CommitDagGraph({
  commits,
  refs,
  selectedCommitHash,
  onSelectCommit,
}: CommitDagGraphProps) {
  if (commits.length === 0) {
    return (
      <div className="glass-surface border border-white/[0.08] rounded-lg p-6 text-center text-xs text-slate-300">
        No commits recorded yet.
      </div>
    );
  }

  // Assign deterministic lanes: main first-parent chain gets lane 0, side branches get lanes 1+
  const mainChain = new Set<string>();
  const commitByHash = new Map<string, CommitObject>(
    commits.map((c) => [c.hash, c])
  );

  let cursor = refs?.branches['main'];
  while (cursor) {
    mainChain.add(cursor);
    const c = commitByHash.get(cursor);
    cursor = c?.parentHashes[0];
  }

  const branchByCommit = new Map<string, string[]>();
  if (refs) {
    for (const [branch, hash] of Object.entries(refs.branches)) {
      const list = branchByCommit.get(hash) ?? [];
      list.push(branch);
      branchByCommit.set(hash, list);
    }
  }

  const headCommitHash =
    refs?.head.type === 'branch'
      ? refs.branches[refs.head.branch]
      : refs?.head.commitHash;

  const nodePositions = new Map<string, PositionedNode>();
  const laneAssigner = new Map<string, number>();
  let nextSideLane = 1;

  commits.forEach((commit, row) => {
    let lane = mainChain.has(commit.hash) ? 0 : laneAssigner.get(commit.hash);
    if (lane === undefined) {
      lane = nextSideLane++;
    }
    if (commit.parentHashes[0] && !mainChain.has(commit.parentHashes[0])) {
      if (!laneAssigner.has(commit.parentHashes[0])) {
        laneAssigner.set(commit.parentHashes[0], lane);
      }
    }
    nodePositions.set(commit.hash, { commit, lane, row });
  });

  const maxLane = Math.max(
    0,
    ...Array.from(nodePositions.values()).map((n) => n.lane)
  );
  const rowHeight = 56;
  const laneSpacing = 26;
  const padLeft = 22;
  const padTop = 26;
  const graphWidth = padLeft + (maxLane + 1) * laneSpacing + 12;
  const svgHeight = padTop + commits.length * rowHeight;

  const laneColors = ['#22D3EE', '#A78BFA', '#34D399', '#F472B6'];

  return (
    <section
      aria-label="Commit Merkle-DAG graph"
      className="glass-surface border border-indigo-300/20 rounded-lg overflow-hidden"
    >
      <div className="px-4 py-2.5 border-b border-indigo-300/15 bg-indigo-500/[0.07] flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white">
          Merkle-DAG History
        </h3>
        <span className="font-mono text-[11px] text-indigo-200 tabular-nums">
          {commits.length} commits
        </span>
      </div>

      <div className="relative overflow-y-auto max-h-[340px] bg-[#090B19]/60">
        <div className="relative" style={{ minHeight: svgHeight }}>
          {/* SVG Edges & Nodes */}
          <svg
            width={graphWidth}
            height={svgHeight}
            className="absolute top-0 left-0 pointer-events-none"
            aria-hidden="true"
          >
            {commits.map((commit) => {
              const from = nodePositions.get(commit.hash)!;
              const x1 = padLeft + from.lane * laneSpacing;
              const y1 = padTop + from.row * rowHeight;

              return commit.parentHashes.map((parentHash, pIdx) => {
                const to = nodePositions.get(parentHash);
                if (!to) return null;
                const x2 = padLeft + to.lane * laneSpacing;
                const y2 = padTop + to.row * rowHeight;
                const color =
                  laneColors[(pIdx === 0 ? from.lane : to.lane) % laneColors.length];

                if (x1 === x2) {
                  return (
                    <line
                      key={`${commit.hash}-${parentHash}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={color}
                      strokeOpacity={0.65}
                      strokeWidth={2}
                    />
                  );
                }

                const midY = (y1 + y2) / 2;
                return (
                  <path
                    key={`${commit.hash}-${parentHash}`}
                    d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                    fill="none"
                    stroke={color}
                    strokeOpacity={0.7}
                    strokeWidth={2}
                    strokeDasharray={pIdx > 0 ? '4 3' : undefined}
                  />
                );
              });
            })}

            {commits.map((commit) => {
              const pos = nodePositions.get(commit.hash)!;
              const cx = padLeft + pos.lane * laneSpacing;
              const cy = padTop + pos.row * rowHeight;
              const color = laneColors[pos.lane % laneColors.length];
              const isSelected = selectedCommitHash === commit.hash;
              const isHead = headCommitHash === commit.hash;

              return (
                <g key={`node-${commit.hash}`}>
                  {isSelected && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={10}
                      fill="none"
                      stroke="#F8FAFC"
                      strokeWidth={1.5}
                      strokeOpacity={0.85}
                    />
                  )}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHead ? 6 : 5}
                    fill={isHead ? color : '#0E122B'}
                    stroke={color}
                    strokeWidth={2.5}
                  />
                </g>
              );
            })}
          </svg>

          {/* Interactive Commit Rows aligned to SVG nodes */}
          <div className="divide-y divide-indigo-300/12">
            {commits.map((commit) => {
              const branchesHere = branchByCommit.get(commit.hash) ?? [];
              const isHead = headCommitHash === commit.hash;
              const isSelected = selectedCommitHash === commit.hash;

              return (
                <button
                  key={`row-${commit.hash}`}
                  type="button"
                  onClick={() => onSelectCommit(commit.hash)}
                  style={{ height: rowHeight, paddingLeft: graphWidth + 8 }}
                  className={`w-full pr-4 text-left flex flex-col justify-center transition-colors ${
                    isSelected
                      ? 'bg-gradient-to-r from-cyan-400/18 to-violet-400/18'
                      : 'hover:bg-indigo-400/[0.08]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] text-cyan-300 shrink-0 tabular-nums">
                      {commit.hash.slice(0, 7)}
                    </span>
                    {isHead && (
                      <span className="font-mono text-[10px] font-semibold text-amber-300 shrink-0">
                        HEAD
                      </span>
                    )}
                    {branchesHere.map((b) => (
                      <span
                        key={b}
                        className="font-mono text-[11px] text-emerald-300 shrink-0"
                      >
                        [{b}]
                      </span>
                    ))}
                    <span className="text-xs text-slate-100 truncate">
                      {commit.message}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-indigo-200/80 mt-0.5">
                    <span>{commit.author}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {new Date(commit.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {commit.parentHashes.length > 1 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-violet-300">Merge</span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
