import { create } from 'zustand';
import type {
  ChronicleServices,
  StorageQuotaInfo,
  WorkspaceNotice,
  ViewMode,
  SearchScope,
  WorkspaceState,
} from './types';
import { createUiLayoutSlice } from './uiLayoutStore';
import { createEditorSessionSlice } from './editorSession';
import { createVcsSlice, EMPTY_STATUS } from './vcsActions';
import { createArchiveSlice } from './archiveActions';
import { createWorkspaceLifecycleSlice, EMPTY_TELEMETRY } from './workspaceLifecycle';

export type {
  ChronicleServices,
  StorageQuotaInfo,
  WorkspaceNotice,
  ViewMode,
  SearchScope,
  WorkspaceState,
};
export { EMPTY_STATUS, EMPTY_TELEMETRY };

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  ...createUiLayoutSlice(set, get),
  ...createEditorSessionSlice(set, get),
  ...createVcsSlice(set, get),
  ...createArchiveSlice(set, get),
  ...createWorkspaceLifecycleSlice(set, get),
}));
