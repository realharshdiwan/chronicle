import { Database, Layers, Percent, Timer, Zap } from "lucide-react";

import type { StorageTelemetry } from "../../core/types";
import type { StorageEstimate } from "../../state/workspace";
import { formatBytes } from "../format";

export interface StorageMetricsCardProps {
  telemetry: StorageTelemetry | null;
  estimate: StorageEstimate | null;
  latencySamples: number[];
}

function Sparkline({ samples }: { samples: number[] }) {
  const width = 190;
  const height = 34;
  const values = samples.length > 0 ? samples : [0];
  const max = Math.max(...values, 0.01);
  const step = values.length > 1 ? width / (values.length - 1) : width;

  const points = values.map((value, index) => {
    const x = values.length === 1 ? width : index * step;
    const y = height - Math.max(2, (value / max) * (height - 4)) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-9 w-full overflow-visible"
      role="img"
      aria-label="IndexedDB write latency sparkline"
    >
      <line
        x1="0"
        y1={height - 1}
        x2={width}
        y2={height - 1}
        stroke="rgba(255,255,255,0.06)"
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="rgb(52 211 153 / 0.8)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {values.length > 0 && (
        <circle
          cx={values.length === 1 ? width : width}
          cy={Number(points[points.length - 1]?.split(",")[1] ?? 0)}
          r="2"
          fill="rgb(52 211 153)"
        />
      )}
    </svg>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Icon className="size-3 text-zinc-500" aria-hidden />
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
          {label}
        </span>
      </div>
      <p className="mt-1 font-mono text-sm text-zinc-200">{value}</p>
      {detail && (
        <p className="mt-0.5 font-mono text-[9px] text-zinc-600">{detail}</p>
      )}
    </div>
  );
}

export function StorageMetricsCard({
  telemetry,
  estimate,
  latencySamples,
}: StorageMetricsCardProps) {
  const lastLatency =
    telemetry?.lastWriteLatencyMs ??
    latencySamples[latencySamples.length - 1] ??
    0;
  const ratio = telemetry?.deduplicationRatio ?? 0;
  const usageRatio =
    estimate && estimate.quota > 0 ? estimate.usage / estimate.quota : 0;

  return (
    <section className="rounded-lg border border-white/[0.07] bg-[#0b0e13] p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Content-addressable storage
        </h3>
        <span className="rounded border border-emerald-400/20 bg-emerald-400/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-emerald-300/80">
          live
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric
          icon={Database}
          label="Blobs"
          value={String(telemetry?.blobCount ?? 0)}
          detail="unique SHA-256"
        />
        <Metric
          icon={Layers}
          label="Trees"
          value={String(telemetry?.treeCount ?? 0)}
          detail="file maps"
        />
        <Metric
          icon={Layers}
          label="Commits"
          value={String(telemetry?.commitCount ?? 0)}
          detail="DAG nodes"
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Metric
          icon={Percent}
          label="Logical bytes"
          value={formatBytes(telemetry?.logicalBytes ?? 0)}
          detail="all commit snapshots"
        />
        <Metric
          icon={Zap}
          label="Physical bytes"
          value={formatBytes(telemetry?.deduplicatedBytes ?? 0)}
          detail={`${(ratio * 100).toFixed(1)}% deduplicated`}
        />
      </div>

      <div className="mt-3 rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
            <Timer className="size-3" aria-hidden />
            IndexedDB write
          </span>
          <span className="font-mono text-[10px] text-emerald-300/90">
            {lastLatency.toFixed(2)} ms
          </span>
        </div>
        <div className="mt-1">
          <Sparkline samples={latencySamples} />
        </div>
        <p className="mt-0.5 font-mono text-[9px] text-zinc-600">
          performance.now() around commit / checkout / merge
        </p>
      </div>

      <div className="mt-3 rounded-md border border-white/[0.06] bg-white/[0.02] p-2.5">
        <div className="flex items-center justify-between font-mono text-[9px] text-zinc-600">
          <span className="uppercase tracking-[0.14em]">
            navigator.storage
          </span>
          <span className="text-zinc-400">
            {formatBytes(estimate?.usage ?? 0)} /{" "}
            {formatBytes(estimate?.quota ?? 0)}
          </span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-emerald-400/60 transition-[width]"
            style={{ width: `${Math.min(100, usageRatio * 100).toFixed(2)}%` }}
          />
        </div>
        <p className="mt-1 font-mono text-[9px] text-zinc-600">
          origin quota pressure {((usageRatio || 0) * 100).toFixed(2)}%
        </p>
      </div>
    </section>
  );
}
