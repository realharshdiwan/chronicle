import type { StorageTelemetry } from '../core/types';
import type { StorageQuotaInfo } from '../state/workspace';

interface StorageMetricsCardProps {
  telemetry: StorageTelemetry;
  quota: StorageQuotaInfo | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function StorageMetricsCard({ telemetry, quota }: StorageMetricsCardProps) {
  const history = telemetry.latencyHistoryMs;
  const maxLatency = Math.max(1, ...history);
  const sparkWidth = 180;
  const sparkHeight = 32;

  const sparkPoints =
    history.length > 1
      ? history
          .map((val, idx) => {
            const x = (idx / (history.length - 1)) * sparkWidth;
            const y = sparkHeight - (val / maxLatency) * (sparkHeight - 6) - 3;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : `0,${sparkHeight - 4} ${sparkWidth},${sparkHeight - 4}`;

  const quotaPct =
    quota && quota.quotaBytes > 0
      ? Math.min(100, Math.max(0.5, (quota.usageBytes / quota.quotaBytes) * 100))
      : 0;

  return (
    <section
      aria-label="CAS storage telemetry"
      className="glass-surface border border-indigo-300/20 rounded-lg p-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white">
          Content-Addressable Store
        </h3>
        <span className="font-mono text-xs text-cyan-300 tabular-nums">
          {telemetry.deduplicationRatio.toFixed(2)}x dedup
        </span>
      </div>

      {/* Object & Byte Grid */}
      <div className="grid grid-cols-3 gap-3 border-y border-indigo-300/15 py-3">
        <div>
          <div className="text-[11px] text-indigo-200/80">Blobs</div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-white tabular-nums">
            {telemetry.blobCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-indigo-200/80">Trees</div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-white tabular-nums">
            {telemetry.treeCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-indigo-200/80">Commits</div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-white tabular-nums">
            {telemetry.commitCount}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-indigo-200/80">Logical</div>
          <div className="mt-0.5 font-mono text-xs font-medium text-indigo-100 tabular-nums">
            {formatBytes(telemetry.logicalBytes)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-indigo-200/80">Physical</div>
          <div className="mt-0.5 font-mono text-xs font-medium text-emerald-300 tabular-nums">
            {formatBytes(telemetry.deduplicatedBytes)}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-indigo-200/80">Write Latency</div>
          <div className="mt-0.5 font-mono text-xs font-medium text-violet-200 tabular-nums">
            {telemetry.lastWriteLatencyMs.toFixed(2)} ms
          </div>
        </div>
      </div>

      {/* Latency Sparkline */}
      <div className="flex items-center justify-between gap-4">
        <span className="text-[11px] text-indigo-200/85 whitespace-nowrap">
          Batch Write Latency
        </span>
        <svg
          width={sparkWidth}
          height={sparkHeight}
          viewBox={`0 0 ${sparkWidth} ${sparkHeight}`}
          aria-label="CAS batch write latency sparkline"
          className="overflow-visible"
        >
          <polyline
            fill="none"
            stroke="#22D3EE"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={sparkPoints}
          />
        </svg>
      </div>

      {/* IndexedDB Quota Bar */}
      {quota && quota.quotaBytes > 0 && (
        <div className="space-y-1.5 pt-1 border-t border-indigo-300/15">
          <div className="flex items-center justify-between text-[11px] text-indigo-200/85">
            <span>IndexedDB Storage Quota</span>
            <span className="font-mono text-indigo-100 tabular-nums">
              {formatBytes(quota.usageBytes)} / {formatBytes(quota.quotaBytes)}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-indigo-950 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-violet-400 rounded-full transition-all"
              style={{ width: `${quotaPct}%` }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
