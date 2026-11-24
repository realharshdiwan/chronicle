import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Link2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ShareLinkModal() {
  const {
    shareModalOpen,
    shareLoading,
    shareBundle,
    pendingSharedImport,
    closeShareModal,
    applySharedImport,
    dismissSharedImport,
  } = useWorkspaceStore();

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [shareBundle, shareModalOpen]);

  if (!shareModalOpen && !pendingSharedImport) return null;

  if (pendingSharedImport) {
    const commitCount = pendingSharedImport.objects.filter(
      (o) => o.type === 'commit'
    ).length;
    const branchCount = Object.keys(pendingSharedImport.refs.branches).length;
    const filePaths = Object.keys(pendingSharedImport.workingTreeFiles).sort();
    const headLabel =
      pendingSharedImport.refs.head.type === 'branch'
        ? pendingSharedImport.refs.head.branch
        : pendingSharedImport.refs.head.commitHash.slice(0, 7);

    return (
      <div
        role="dialog"
        aria-label="Import shared workspace"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050611]/70 backdrop-blur-md"
        onClick={dismissSharedImport}
      >
        <div
          className="w-full max-w-md rounded-xl border border-indigo-300/25 bg-[#121530]/92 backdrop-blur-2xl shadow-[0_24px_70px_rgba(4,6,22,0.82)] p-5 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-cyan-400/18 border border-cyan-300/35 text-cyan-200">
                <Link2 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-sm font-semibold text-white">
                  Shared Workspace Detected
                </h2>
                <p className="text-[11px] text-indigo-200">
                  Cryptographically verified SHA-256 snapshot from URL
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={dismissSharedImport}
              aria-label="Dismiss shared workspace"
              className="p-1 rounded text-indigo-200 hover:text-white hover:bg-indigo-400/20"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 rounded-lg glass-surface border border-indigo-300/18 p-3 text-center">
            <div>
              <div className="text-[11px] text-indigo-200/80">Files</div>
              <div className="font-mono text-sm font-semibold text-white tabular-nums">
                {filePaths.length}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-indigo-200/80">Commits</div>
              <div className="font-mono text-sm font-semibold text-white tabular-nums">
                {commitCount}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-indigo-200/80">Branches</div>
              <div className="font-mono text-sm font-semibold text-white tabular-nums">
                {branchCount}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-indigo-200/80">HEAD</div>
              <div className="font-mono text-xs font-semibold text-cyan-300 truncate pt-0.5">
                {headLabel}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-indigo-200">
              Included working tree files
            </div>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-indigo-300/18 bg-[#090B19]/75 p-2.5 space-y-1 font-mono text-[11px] text-indigo-50">
              {filePaths.slice(0, 8).map((p) => (
                <div key={p} className="truncate">
                  {p}
                </div>
              ))}
              {filePaths.length > 8 && (
                <div className="text-indigo-200/70">
                  + {filePaths.length - 8} more file(s)
                </div>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-400/35 bg-amber-400/12 p-3 text-xs text-amber-100">
            <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
            <span>
              Loading this shared link will replace your current local IndexedDB
              workspace.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={dismissSharedImport}
              className="px-3.5 py-2 text-xs font-medium rounded-md border border-indigo-300/20 bg-indigo-500/12 text-indigo-100 hover:text-white hover:bg-indigo-500/22 transition-colors"
            >
              Keep Current
            </button>
            <button
              type="button"
              onClick={() => void applySharedImport(pendingSharedImport)}
              className="px-4 py-2 text-xs font-semibold rounded-md bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 hover:from-cyan-300 hover:to-violet-300 transition-colors"
            >
              Load Shared Workspace
            </button>
          </div>
        </div>
      </div>
    );
  }

  const shareUrl = shareBundle
    ? typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}#${shareBundle.fragment}`
      : `#${shareBundle.fragment}`
    : '';

  const savingsPct =
    shareBundle && shareBundle.rawBytes > 0
      ? Math.max(
          0,
          Math.round(
            (1 - shareBundle.compressedBytes / shareBundle.rawBytes) * 100
          )
        )
      : 0;

  const commitCount = shareBundle
    ? shareBundle.payload.objects.filter((o) => o.type === 'commit').length
    : 0;
  const branchCount = shareBundle
    ? Object.keys(shareBundle.payload.refs.branches).length
    : 0;
  const fileCount = shareBundle
    ? Object.keys(shareBundle.payload.workingTreeFiles).length
    : 0;

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      const input = document.getElementById(
        'share-link-url-input'
      ) as HTMLInputElement | null;
      if (input) {
        input.select();
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Share workspace via link"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050611]/70 backdrop-blur-md"
      onClick={closeShareModal}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-indigo-300/25 bg-[#121530]/92 backdrop-blur-2xl shadow-[0_24px_70px_rgba(4,6,22,0.82)] p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-violet-400/18 border border-violet-300/35 text-violet-200">
              <Link2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">
                Share Workspace via Link
              </h2>
              <p className="text-[11px] text-indigo-200">
                Entire Merkle-DAG history &amp; working tree compressed into URL
                fragment
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeShareModal}
            aria-label="Close share dialog"
            className="p-1 rounded text-indigo-200 hover:text-white hover:bg-indigo-400/20"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {shareLoading || !shareBundle ? (
          <div className="py-8 text-center text-xs text-indigo-200">
            Compressing and sanitizing repository snapshot...
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 rounded-lg glass-surface border border-indigo-300/18 p-3 text-center">
              <div>
                <div className="text-[11px] text-indigo-200/80">Files</div>
                <div className="font-mono text-sm font-semibold text-white tabular-nums">
                  {fileCount}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-indigo-200/80">Commits</div>
                <div className="font-mono text-sm font-semibold text-white tabular-nums">
                  {commitCount}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-indigo-200/80">Branches</div>
                <div className="font-mono text-sm font-semibold text-white tabular-nums">
                  {branchCount}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-indigo-200/80">Compressed</div>
                <div className="font-mono text-xs font-semibold text-emerald-300 tabular-nums pt-0.5">
                  {formatBytes(shareBundle.compressedBytes)} (-{savingsPct}%)
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-400/35 bg-emerald-500/[0.10] p-3 space-y-1.5 text-xs">
              <div className="flex items-center gap-2 font-medium text-emerald-200">
                <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>Sensitive data excluded automatically</span>
              </div>
              <p className="text-[11px] text-slate-200 leading-relaxed pl-6">
                Env files, private keys, and credential patterns are stripped or
                redacted before generating the URL fragment. Everything stays
                client-side with zero server upload.
              </p>
              {(shareBundle.stats.excludedFileCount > 0 ||
                shareBundle.stats.redactedSecretCount > 0) && (
                <div className="pl-6 pt-1 text-[11px] font-mono text-amber-200">
                  Sanitized: {shareBundle.stats.excludedFileCount} file(s)
                  excluded, {shareBundle.stats.redactedSecretCount} secret(s)
                  redacted
                  {shareBundle.stats.excludedPaths.length > 0 && (
                    <span className="text-indigo-200">
                      {' '}
                      ({shareBundle.stats.excludedPaths.join(', ')})
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="share-link-url-input"
                className="text-[11px] font-medium text-indigo-200 block"
              >
                Direct link ({shareUrl.length.toLocaleString()} chars)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="share-link-url-input"
                  type="text"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 bg-[#090B19]/85 border border-indigo-300/25 rounded-md px-3 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-cyan-300"
                />
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 hover:from-cyan-300 hover:to-violet-300 transition-colors whitespace-nowrap shrink-0"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {shareUrl.length > 32000 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-400/35 bg-amber-400/12 p-2.5 text-[11px] text-amber-100">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
                <span>
                  This link is large ({shareUrl.length.toLocaleString()} chars).
                  For very large repositories, use Backup &amp; Import (.zip / .json).
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
