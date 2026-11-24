import { useEffect, useState, type DragEvent } from 'react';
import { Upload, X } from 'lucide-react';
import { BackupImportModal } from './components/BackupImportModal';
import { CommandPalette } from './components/CommandPalette';
import { DiffViewer } from './components/DiffViewer';
import { GuidedTourBar } from './components/GuidedTourBar';
import { MarkdownEditor } from './components/MarkdownEditor';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SearchModal } from './components/SearchModal';
import { ShareLinkModal } from './components/ShareLinkModal';
import { SidebarTree } from './components/SidebarTree';
import { TopBar } from './components/TopBar';
import { WorkspaceModal } from './components/WorkspaceModal';
import { XRayDrawer } from './components/XRayDrawer';
import { importFromUploadedFiles } from './core/archive/repoArchive';
import { useWorkspaceStore } from './state/workspace';

export default function App() {
  const {
    initialized,
    loading,
    viewMode,
    notice,
    initWorkspace,
    disposeWorkspace,
    clearNotice,
    setPaletteOpen,
    setSearchOpen,
    setXRayOpen,
    setWorkspaceModalOpen,
    setBackupModalOpen,
    closeShareModal,
    handleShareHash,
    importFilesIntoWorkingTree,
    importArchivePayload,
    setNotice,
  } = useWorkspaceStore();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [globalFileDrag, setGlobalFileDrag] = useState(false);

  useEffect(() => {
    void initWorkspace();
    return () => {
      disposeWorkspace();
    };
  }, [initWorkspace, disposeWorkspace]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setPaletteOpen(false);
        setWorkspaceModalOpen(false);
        setBackupModalOpen(false);
        setSearchOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(false);
        setWorkspaceModalOpen(false);
        setBackupModalOpen(false);
        setPaletteOpen(true);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        setSearchOpen(false);
        setXRayOpen(false);
        setWorkspaceModalOpen(false);
        setBackupModalOpen(false);
        closeShareModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const onHashChange = () => {
      void handleShareHash(window.location.hash);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [
    setPaletteOpen,
    setSearchOpen,
    setXRayOpen,
    setWorkspaceModalOpen,
    setBackupModalOpen,
    closeShareModal,
    handleShareHash,
  ]);

  const handleGlobalDrop = async (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.files || e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    setGlobalFileDrag(false);
    try {
      const inputs: Array<{ path: string; bytes: Uint8Array }> = [];
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i];
        const rel =
          (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
          f.name;
        const buf = await f.arrayBuffer();
        inputs.push({ path: rel, bytes: new Uint8Array(buf) });
      }
      const outcome = await importFromUploadedFiles(inputs);
      if (outcome.kind === 'archive') {
        await importArchivePayload(outcome.archive, 'new-workspace');
      } else {
        importFilesIntoWorkingTree(outcome.files, outcome.skippedCount);
      }
    } catch (err) {
      setNotice({
        type: 'error',
        message:
          err instanceof Error ? err.message : 'Failed to import dropped files.',
      });
    }
  };

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setGlobalFileDrag(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) {
          setGlobalFileDrag(false);
        }
      }}
      onDrop={(e) => void handleGlobalDrop(e)}
      className="h-screen w-screen overflow-hidden flex flex-col bg-[#0B0D1A] bg-[radial-gradient(ellipse_78%_52%_at_16%_-8%,rgba(139,92,246,0.24),transparent_62%),radial-gradient(ellipse_62%_46%_at_86%_6%,rgba(6,182,212,0.20),transparent_60%),radial-gradient(ellipse_50%_42%_at_10%_94%,rgba(236,72,153,0.14),transparent_62%),radial-gradient(ellipse_48%_40%_at_90%_90%,rgba(16,185,129,0.12),transparent_62%)] text-slate-100 relative"
    >
      <TopBar onToggleMobileSidebar={() => setMobileSidebarOpen((v) => !v)} />
      <GuidedTourBar />

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`px-4 py-2 text-xs font-medium border-b backdrop-blur-md flex items-center justify-between gap-3 shrink-0 ${
            notice.type === 'error'
              ? 'bg-rose-950/65 border-rose-400/40 text-rose-100'
              : notice.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-400/40 text-emerald-100'
                : 'bg-indigo-950/75 border-indigo-300/20 text-indigo-50'
          }`}
        >
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={clearNotice}
            aria-label="Dismiss notification"
            className="p-0.5 rounded hover:bg-white/10"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex relative">
        <SidebarTree
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <main className="flex-1 min-w-0 flex flex-col">
          {!initialized && loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-indigo-200">
              Hydrating local IndexedDB repository...
            </div>
          ) : viewMode === 'diff' ? (
            <DiffViewer />
          ) : (
            <MarkdownEditor />
          )}
        </main>
      </div>

      <XRayDrawer />
      <CommandPalette />
      <SearchModal />
      <ShareLinkModal />
      <WorkspaceModal />
      <BackupImportModal />
      <OfflineIndicator />

      {globalFileDrag && (
        <div
          className="fixed inset-0 z-50 bg-[#050611]/75 backdrop-blur-md flex items-center justify-center p-6 pointer-events-none"
          aria-hidden="true"
        >
          <div className="rounded-2xl border-2 border-dashed border-cyan-300/75 bg-[#121530]/90 px-10 py-8 text-center space-y-2 shadow-2xl">
            <Upload className="w-8 h-8 mx-auto text-cyan-300" />
            <div className="font-display text-base font-semibold text-white">
              Drop to Import into Chronicle
            </div>
            <p className="text-xs text-indigo-200">
              Supports .zip / .json repository backups and Markdown files
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
