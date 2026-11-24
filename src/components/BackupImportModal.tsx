import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import {
  Archive,
  Download,
  FileCode2,
  FolderUp,
  Upload,
  X,
} from 'lucide-react';
import {
  importFromUploadedFiles,
  type ChronicleArchiveV1,
} from '../core/archive/repoArchive';
import { useWorkspaceStore } from '../state/workspace';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function BackupImportModal() {
  const {
    backupModalOpen,
    setBackupModalOpen,
    exportRepoArchiveJSON,
    exportRepoArchiveZip,
    importArchivePayload,
    importFilesIntoWorkingTree,
    setNotice,
  } = useWorkspaceStore();

  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<ChronicleArchiveV1 | null>(
    null
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  if (!backupModalOpen) return null;

  const handleExportZip = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await exportRepoArchiveZip();
      if (!res) return;
      const copy = new Uint8Array(res.bytes.byteLength);
      copy.set(res.bytes);
      triggerDownload(new Blob([copy.buffer], { type: 'application/zip' }), res.filename);
      setNotice({
        type: 'success',
        message: `Exported full repository backup (${res.filename}).`,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleExportJSON = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await exportRepoArchiveJSON();
      if (!res) return;
      triggerDownload(
        new Blob([res.content], { type: 'application/json' }),
        res.filename
      );
      setNotice({
        type: 'success',
        message: `Exported portable JSON archive (${res.filename}).`,
      });
    } finally {
      setBusy(false);
    }
  };

  const processFileList = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setBusy(true);
    setErrorMsg(null);
    setPendingArchive(null);

    try {
      const inputs: Array<{ path: string; bytes: Uint8Array }> = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i];
        const rel =
          (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
          f.name;
        const buf = await f.arrayBuffer();
        inputs.push({ path: rel, bytes: new Uint8Array(buf) });
      }

      const outcome = await importFromUploadedFiles(inputs);
      if (outcome.kind === 'archive') {
        setPendingArchive(outcome.archive);
      } else {
        importFilesIntoWorkingTree(outcome.files, outcome.skippedCount);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to read selected files.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void processFileList(e.dataTransfer.files);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    void processFileList(e.target.files);
    e.target.value = '';
  };

  return (
    <div
      role="dialog"
      aria-label="Backup and import workspace"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#050611]/72 backdrop-blur-md"
      onClick={() => {
        setPendingArchive(null);
        setErrorMsg(null);
        setBackupModalOpen(false);
      }}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-indigo-300/25 bg-[#121530]/94 backdrop-blur-2xl shadow-[0_24px_70px_rgba(4,6,22,0.85)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-indigo-300/15 bg-indigo-950/35 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-violet-400/15 border border-violet-300/35 text-violet-200">
              <Archive className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-sm font-semibold text-white">
                Backup &amp; Import Repository
              </h2>
              <p className="text-[11px] text-indigo-200">
                Full .zip / .json Merkle-DAG backups or Markdown folder imports with zero URL size limits
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setPendingArchive(null);
              setErrorMsg(null);
              setBackupModalOpen(false);
            }}
            aria-label="Close backup and import dialog"
            className="p-1.5 rounded text-indigo-200 hover:text-white hover:bg-indigo-400/20"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Export Section */}
          <div className="space-y-2.5">
            <div className="text-xs font-semibold text-indigo-100">
              Export Current Workspace
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleExportZip()}
                className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-cyan-300/35 bg-cyan-400/14 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/24 hover:text-white transition-colors disabled:opacity-50"
              >
                <Download className="w-4 h-4 text-cyan-300" />
                <span>Full Backup (.zip)</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleExportJSON()}
                className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-lg border border-indigo-300/25 bg-indigo-500/14 text-xs font-semibold text-indigo-100 hover:bg-indigo-500/25 hover:text-white transition-colors disabled:opacity-50"
              >
                <FileCode2 className="w-4 h-4 text-violet-300" />
                <span>DAG Archive (.json)</span>
              </button>
            </div>
            <p className="text-[11px] text-indigo-200/75 leading-relaxed">
              <code>.zip</code> exports include every readable Markdown file at its folder path alongside the full SHA-256 commit history.
            </p>
          </div>

          {/* Import / Drop Zone */}
          <div className="pt-4 border-t border-indigo-300/15 space-y-3">
            <div className="text-xs font-semibold text-indigo-100">
              Import Archive or Markdown Files
            </div>

            {pendingArchive ? (
              <div className="rounded-lg border border-cyan-300/35 bg-[#0A0C1B]/80 p-4 space-y-3">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-white">
                    Verified Archive: {pendingArchive.workspaceName}
                  </div>
                  <div className="text-[11px] font-mono text-indigo-200/80 tabular-nums">
                    {pendingArchive.objects.filter((o) => o.type === 'commit').length} commits ·{' '}
                    {Object.keys(pendingArchive.refs.branches).length} branches ·{' '}
                    {Object.keys(pendingArchive.workingTreeFiles).length} working files
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPendingArchive(null)}
                    className="px-3 py-1.5 text-xs text-indigo-200 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void importArchivePayload(pendingArchive, 'replace-current')
                    }
                    className="px-3 py-1.5 text-xs font-medium rounded-md border border-indigo-300/25 bg-indigo-500/15 text-indigo-100 hover:bg-indigo-500/25"
                  >
                    Replace Current
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void importArchivePayload(pendingArchive, 'new-workspace')
                    }
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-md bg-gradient-to-r from-cyan-400 to-violet-400 text-slate-950 hover:from-cyan-300 hover:to-violet-300"
                  >
                    Import as New Workspace
                  </button>
                </div>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                className={`rounded-lg border-2 border-dashed p-5 text-center space-y-3 transition-colors ${
                  dragging
                    ? 'border-cyan-300 bg-cyan-400/12'
                    : 'border-indigo-300/25 bg-[#090B19]/60 hover:border-indigo-300/45'
                }`}
              >
                <Upload className="w-6 h-6 mx-auto text-violet-300" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-white">
                    Drag &amp; drop a <code>.zip</code>, <code>.json</code> archive, or Markdown files here
                  </p>
                  <p className="text-[11px] text-indigo-200/75">
                    Archives restore full commit history; Markdown files merge directly into your working tree.
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-indigo-300/25 bg-indigo-500/15 text-indigo-100 hover:bg-indigo-500/25 hover:text-white transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5 text-cyan-300" />
                    <span>Choose Files</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-indigo-300/25 bg-indigo-500/15 text-indigo-100 hover:bg-indigo-500/25 hover:text-white transition-colors"
                  >
                    <FolderUp className="w-3.5 h-3.5 text-violet-300" />
                    <span>Choose Folder</span>
                  </button>
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".zip,.json,.md,.markdown,.txt"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Upload archive or markdown files"
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  // @ts-expect-error webkitdirectory is supported in Chromium/WebKit browsers
                  webkitdirectory=""
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Upload folder of markdown files"
                />
              </div>
            )}

            {errorMsg && (
              <div
                role="alert"
                className="rounded-md border border-rose-400/40 bg-rose-950/50 px-3 py-2 text-xs text-rose-200"
              >
                {errorMsg}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
