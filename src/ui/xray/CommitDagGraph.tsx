import { useMemo } from "react";

import type { CommitObject, Sha256Hash } from "../../core/types";
import { shortHash } from "../format";

export interface CommitDagGraphProps {
  commits: CommitObject[];
  branches: Record<string, Sha256Hash>;
  activeBranch: string | null;
  onSelect(commit: CommitObject): void;
}

const LANE_COLORS = ["#34d399", "#38bdf8", "#c084fc", "#fbbf24"];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length] ?? "#34d399";
}

export function CommitDagGraph({
  commits,
  branches,
  activeBranch,
  onSelect,
}: CommitDagGraphProps) {
  const layout = useMemo(() => {
    const ordered = [...commits].sort((left, right) => {
      if (left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp;
      }
      return left.hash < right.hash ? -1 : left.hash > right.hash ? 1 : 0;
    });
    const byHash = new Map(ordered.map((commit) => [commit.hash, commit]));

    const branchNames = Object.keys(branches).sort((left, right) => {
      if (left === "main") return -1;
      if (right === "main") return 1;
      return left.localeCompare(right);
    });

    const laneByHash = new Map<Sha256Hash, number>();
    branchNames.forEach((name, lane) => {
      const head = branches[name];
      if (!head) return;
      const stack: Sha256Hash[] = [head];
      const visited = new Set<Sha256Hash>();
      while (stack.length > 0) {
        const hash = stack.pop();
        if (!hash || visited.has(hash)) continue;
        visited.add(hash);
        if (!laneByHash.has(hash)) laneByHash.set(hash, lane);
        const commit = byHash.get(hash);
        if (commit) stack.push(...commit.parentHashes);
      }
    });

    const maxLane = Math.max(0, ...laneByHash.values());
    const xSpacing = 134;
    const ySpacing = 78;
    const leftPadding = 58;
    const topPadding = 46;
    const nodes = new Map<
      Sha256Hash,
      { commit: CommitObject; x: number; y: number; lane: number }
    >();

    ordered.forEach((commit, index) => {
      const lane = laneByHash.get(commit.hash) ?? 0;
      nodes.set(commit.hash, {
        commit,
        x: leftPadding + index * xSpacing,
        y: topPadding + lane * ySpacing,
        lane,
      });
    });

    const width = Math.max(320, leftPadding + ordered.length * xSpacing + 20);
    const height = topPadding + maxLane * ySpacing + 58;

    const edges: Array<{
      key: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
      color: string;
    }> = [];

    for (const commit of ordered) {
      const target = nodes.get(commit.hash);
      if (!target) continue;
      for (const parentHash of commit.parentHashes) {
        const parent = nodes.get(parentHash);
        if (!parent) continue;
        edges.push({
          key: `${parentHash}-${commit.hash}`,
          from: parent,
          to: target,
          color: laneColor(target.lane),
        });
      }
    }

    const headHash = activeBranch ? branches[activeBranch] : null;
    const branchHeads = branchNames
      .map((name) => ({ name, hash: branches[name] }))
      .filter((entry): entry is { name: string; hash: Sha256Hash } =>
        Boolean(entry.hash),
      );

    return { ordered, nodes, edges, width, height, headHash, branchHeads };
  }, [activeBranch, branches, commits]);

  if (commits.length === 0) {
    return (
      <p className="rounded-md border border-white/[0.06] px-3 py-6 text-center font-mono text-[10px] text-zinc-600">
        No commits yet
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.07] bg-[#0b0e13] p-2">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        className="max-w-none"
        role="img"
        aria-label="Merkle DAG commit graph"
      >
        {layout.edges.map((edge) => {
          const mid = (edge.from.x + edge.to.x) / 2;
          return (
            <path
              key={edge.key}
              d={`M ${edge.from.x} ${edge.from.y} C ${mid} ${edge.from.y}, ${mid} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`}
              fill="none"
              stroke={edge.color}
              strokeOpacity="0.35"
              strokeWidth="1.5"
            />
          );
        })}

        {[...layout.nodes.values()].map(({ commit, x, y, lane }) => {
          const color = laneColor(lane);
          const isHead = layout.headHash === commit.hash;
          return (
            <g
              key={commit.hash}
              transform={`translate(${x}, ${y})`}
              onClick={() => onSelect(commit)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(commit);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Inspect commit ${shortHash(commit.hash)}: ${commit.message}`}
              className="cursor-pointer outline-none"
            >
              <title>
                {shortHash(commit.hash)} · {commit.message}
              </title>
              {isHead && (
                <rect
                  x="-58"
                  y="-28"
                  width="116"
                  height="56"
                  rx="10"
                  fill="none"
                  stroke={color}
                  strokeOpacity="0.35"
                  strokeDasharray="3 3"
                />
              )}
              <rect
                x="-54"
                y="-24"
                width="108"
                height="48"
                rx="8"
                fill="#0f131a"
                stroke={color}
                strokeOpacity={isHead ? "0.9" : "0.35"}
              />
              <circle cx="-42" cy="-10" r="3" fill={color} />
              <text
                x="-35"
                y="-7"
                fill="#d4d4d8"
                fontFamily="var(--font-mono)"
                fontSize="9"
              >
                {shortHash(commit.hash)}
              </text>
              <text
                x="-42"
                y="12"
                fill="#a1a1aa"
                fontFamily="var(--font-mono)"
                fontSize="8.5"
              >
                {commit.message.length > 19
                  ? `${commit.message.slice(0, 18)}…`
                  : commit.message}
              </text>
            </g>
          );
        })}

        {layout.branchHeads.map(({ name, hash }) => {
          const node = layout.nodes.get(hash);
          if (!node) return null;
          return (
            <text
              key={name}
              x={node.x}
              y={node.y - 34}
              textAnchor="middle"
              fill={laneColor(node.lane)}
              fontFamily="var(--font-mono)"
              fontSize="8"
            >
              {name}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
