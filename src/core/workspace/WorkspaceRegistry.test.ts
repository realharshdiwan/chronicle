import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AUTHOR_NAME,
  DEFAULT_WORKSPACE_ID,
  getWorkspaceDBNames,
  InMemoryWorkspaceRegistryStorage,
  WorkspaceRegistry,
} from './WorkspaceRegistry';

test('WorkspaceRegistry initializes default workspace and preserves legacy DB names', () => {
  const storage = new InMemoryWorkspaceRegistryStorage();
  const registry = new WorkspaceRegistry(storage);

  assert.equal(registry.getActiveWorkspaceId(), DEFAULT_WORKSPACE_ID);
  assert.equal(registry.getAuthorName(), DEFAULT_AUTHOR_NAME);
  assert.equal(registry.listWorkspaces().length, 1);

  const defaultDbs = getWorkspaceDBNames(DEFAULT_WORKSPACE_ID);
  assert.equal(defaultDbs.casDbName, 'chronicle-cas-db');
  assert.equal(defaultDbs.searchDbName, 'chronicle-search-index-db');
  assert.equal(defaultDbs.crdtDocName, 'chronicle-working-tree');
  assert.equal(defaultDbs.broadcastChannelName, 'chronicle-crdt-sync');
});

test('WorkspaceRegistry creates, renames, switches, and deletes isolated workspaces', () => {
  const storage = new InMemoryWorkspaceRegistryStorage();
  const registry = new WorkspaceRegistry(storage);

  const research = registry.createWorkspace('Research Notes', 'blank');
  assert.equal(registry.getActiveWorkspaceId(), research.id);
  assert.equal(registry.listWorkspaces().length, 2);

  const customDbs = getWorkspaceDBNames(research.id);
  assert.ok(customDbs.casDbName.includes(research.id));
  assert.ok(customDbs.searchDbName.includes(research.id));
  assert.ok(customDbs.crdtDocName.includes(research.id));
  assert.ok(customDbs.broadcastChannelName.includes(research.id));

  registry.renameWorkspace(research.id, 'Systems Research');
  assert.equal(registry.getActiveWorkspace().name, 'Systems Research');

  registry.setAuthorName('Ada Lovelace');
  // Rehydrate from persistence
  const reloaded = new WorkspaceRegistry(storage);
  assert.equal(reloaded.getAuthorName(), 'Ada Lovelace');
  assert.equal(reloaded.getActiveWorkspace().name, 'Systems Research');

  const del = reloaded.deleteWorkspace(research.id);
  assert.equal(del.nextActiveId, DEFAULT_WORKSPACE_ID);
  assert.equal(reloaded.listWorkspaces().length, 1);

  assert.throws(() => reloaded.deleteWorkspace(DEFAULT_WORKSPACE_ID));
});
