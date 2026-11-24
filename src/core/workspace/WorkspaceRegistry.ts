export type WorkspaceKind = 'demo' | 'blank' | 'imported';

export interface WorkspaceMeta {
  id: string;
  name: string;
  kind: WorkspaceKind;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceDBNames {
  casDbName: string;
  searchDbName: string;
  crdtDocName: string;
  broadcastChannelName: string;
}

export interface WorkspaceRegistryData {
  version: 1;
  activeWorkspaceId: string;
  authorName: string;
  workspaces: WorkspaceMeta[];
}

export interface IWorkspaceRegistryStorage {
  load(): WorkspaceRegistryData | null;
  save(data: WorkspaceRegistryData): void;
}

export const DEFAULT_WORKSPACE_ID = 'default';
export const DEFAULT_AUTHOR_NAME = 'Chronicle Author';
const STORAGE_KEY = 'chronicle_workspace_registry_v1';

export class InMemoryWorkspaceRegistryStorage implements IWorkspaceRegistryStorage {
  private data: WorkspaceRegistryData | null = null;

  load(): WorkspaceRegistryData | null {
    return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
  }

  save(data: WorkspaceRegistryData): void {
    this.data = JSON.parse(JSON.stringify(data)) as WorkspaceRegistryData;
  }
}

export class LocalStorageWorkspaceRegistryStorage implements IWorkspaceRegistryStorage {
  load(): WorkspaceRegistryData | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as WorkspaceRegistryData;
    } catch {
      return null;
    }
  }

  save(data: WorkspaceRegistryData): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage quota errors for tiny registry metadata
    }
  }
}

/**
 * Computes deterministic, isolated IndexedDB and BroadcastChannel names per workspace.
 * Preserves legacy database names for the default workspace so existing local data stays intact.
 */
export function getWorkspaceDBNames(workspaceId: string): WorkspaceDBNames {
  if (!workspaceId || workspaceId === DEFAULT_WORKSPACE_ID) {
    return {
      casDbName: 'chronicle-cas-db',
      searchDbName: 'chronicle-search-index-db',
      crdtDocName: 'chronicle-working-tree',
      broadcastChannelName: 'chronicle-crdt-sync',
    };
  }
  return {
    casDbName: `chronicle-cas-db:${workspaceId}`,
    searchDbName: `chronicle-search-index-db:${workspaceId}`,
    crdtDocName: `chronicle-working-tree:${workspaceId}`,
    broadcastChannelName: `chronicle-crdt-sync:${workspaceId}`,
  };
}

function makeWorkspaceId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  const suffix = Math.random().toString(36).slice(2, 7);
  return `ws-${slug || 'notebook'}-${suffix}`;
}

export class WorkspaceRegistry {
  private storage: IWorkspaceRegistryStorage;
  private data: WorkspaceRegistryData;

  constructor(storage: IWorkspaceRegistryStorage = new LocalStorageWorkspaceRegistryStorage()) {
    this.storage = storage;
    const loaded = storage.load();
    if (
      loaded &&
      loaded.version === 1 &&
      Array.isArray(loaded.workspaces) &&
      loaded.workspaces.length > 0
    ) {
      const activeExists = loaded.workspaces.some(
        (w) => w.id === loaded.activeWorkspaceId
      );
      this.data = {
        version: 1,
        activeWorkspaceId: activeExists
          ? loaded.activeWorkspaceId
          : loaded.workspaces[0].id,
        authorName: loaded.authorName?.trim() || DEFAULT_AUTHOR_NAME,
        workspaces: loaded.workspaces,
      };
    } else {
      const now = Date.now();
      this.data = {
        version: 1,
        activeWorkspaceId: DEFAULT_WORKSPACE_ID,
        authorName: DEFAULT_AUTHOR_NAME,
        workspaces: [
          {
            id: DEFAULT_WORKSPACE_ID,
            name: 'Chronicle Demo',
            kind: 'demo',
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
      this.storage.save(this.data);
    }
  }

  getState(): WorkspaceRegistryData {
    return {
      ...this.data,
      workspaces: this.data.workspaces.map((w) => ({ ...w })),
    };
  }

  listWorkspaces(): WorkspaceMeta[] {
    return this.data.workspaces.map((w) => ({ ...w }));
  }

  getActiveWorkspace(): WorkspaceMeta {
    return (
      this.data.workspaces.find((w) => w.id === this.data.activeWorkspaceId) ??
      this.data.workspaces[0]
    );
  }

  getActiveWorkspaceId(): string {
    return this.getActiveWorkspace().id;
  }

  getAuthorName(): string {
    return this.data.authorName;
  }

  setAuthorName(name: string): string {
    const cleaned = name.trim();
    if (!cleaned) {
      throw new Error('Author name cannot be empty.');
    }
    this.data.authorName = cleaned.slice(0, 64);
    this.storage.save(this.data);
    return this.data.authorName;
  }

  createWorkspace(name: string, kind: WorkspaceKind = 'blank'): WorkspaceMeta {
    const cleaned = name.trim();
    if (!cleaned) {
      throw new Error('Workspace name cannot be empty.');
    }
    const now = Date.now();
    const meta: WorkspaceMeta = {
      id: makeWorkspaceId(cleaned),
      name: cleaned.slice(0, 64),
      kind,
      createdAt: now,
      updatedAt: now,
    };
    this.data.workspaces.push(meta);
    this.data.activeWorkspaceId = meta.id;
    this.storage.save(this.data);
    return { ...meta };
  }

  setActiveWorkspace(id: string): WorkspaceMeta {
    const found = this.data.workspaces.find((w) => w.id === id);
    if (!found) {
      throw new Error(`Workspace "${id}" does not exist.`);
    }
    found.updatedAt = Date.now();
    this.data.activeWorkspaceId = found.id;
    this.storage.save(this.data);
    return { ...found };
  }

  renameWorkspace(id: string, nextName: string): WorkspaceMeta {
    const cleaned = nextName.trim();
    if (!cleaned) {
      throw new Error('Workspace name cannot be empty.');
    }
    const found = this.data.workspaces.find((w) => w.id === id);
    if (!found) {
      throw new Error(`Workspace "${id}" does not exist.`);
    }
    found.name = cleaned.slice(0, 64);
    found.updatedAt = Date.now();
    this.storage.save(this.data);
    return { ...found };
  }

  deleteWorkspace(id: string): { nextActiveId: string; deleted: WorkspaceMeta } {
    if (this.data.workspaces.length <= 1) {
      throw new Error('Cannot delete the only remaining workspace.');
    }
    const idx = this.data.workspaces.findIndex((w) => w.id === id);
    if (idx === -1) {
      throw new Error(`Workspace "${id}" does not exist.`);
    }
    const [deleted] = this.data.workspaces.splice(idx, 1);
    if (this.data.activeWorkspaceId === id) {
      this.data.activeWorkspaceId = this.data.workspaces[0].id;
    }
    this.storage.save(this.data);
    return {
      nextActiveId: this.data.activeWorkspaceId,
      deleted: { ...deleted },
    };
  }
}
