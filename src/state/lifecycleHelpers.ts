import type { ChronicleServices } from './types';
import type { PendingMergeState } from '../core/types';
import { diffWorkingTree } from '../core/vcs/diff';
import { computeStorageTelemetry } from '../core/cas/telemetry';
import { createServices, readStorageQuota } from './servicesSetup';
import type { WorkspaceMeta } from '../core/workspace/WorkspaceRegistry';

export interface SetupCallbacks {
  recordLatency: (ms: number) => void;
  scheduleRefresh: () => void;
  onBranchSync: () => void;
  onPeerSync: () => void;
}

export async function bootServices(
  meta: WorkspaceMeta,
  authorName: string,
  forceSeed: boolean,
  cb: SetupCallbacks
): Promise<ChronicleServices> {
  return createServices(
    { workspaceMeta: meta, authorName, forceSeed },
    cb.recordLatency,
    cb.scheduleRefresh,
    cb.onBranchSync,
    cb.onPeerSync
  );
}

export async function collectRefreshedState(
  services: ChronicleServices,
  pendingMerge: PendingMergeState | null,
  activeFile: string | null,
  latencyHistoryMs: number[]
) {
  const files = services.workingTree.getFileMap();
  const filePaths = Object.keys(files).sort();
  const refs = await services.repo.getRefs();
  const headHash = await services.repo.getHeadCommitHash();
  const [status, diffs, commits, quota] = await Promise.all([
    services.repo.status(files, pendingMerge),
    diffWorkingTree(services.storage, headHash, files),
    services.repo.getAllCommits(),
    readStorageQuota(),
  ]);

  const lastLatency =
    latencyHistoryMs.length > 0 ? latencyHistoryMs[latencyHistoryMs.length - 1] : 0;
  const telemetry = await computeStorageTelemetry(
    services.storage,
    lastLatency,
    latencyHistoryMs
  );

  let nextActiveFile = activeFile;
  if (nextActiveFile && !files[nextActiveFile]) {
    nextActiveFile = filePaths[0] ?? null;
  } else if (!nextActiveFile && filePaths.length > 0) {
    nextActiveFile = filePaths.includes('README.md') ? 'README.md' : filePaths[0];
  }

  return {
    files,
    filePaths,
    activeFile: nextActiveFile,
    refs,
    commits,
    status,
    diffs,
    telemetry,
    quota,
    peerCount: services.bridge.getPeerCount(),
    canUndoActive: nextActiveFile ? services.undoManager.canUndo(nextActiveFile) : false,
    canRedoActive: nextActiveFile ? services.undoManager.canRedo(nextActiveFile) : false,
  };
}
