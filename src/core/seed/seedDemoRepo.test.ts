import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryObjectStorage } from '../cas/ObjectStore';
import { Repository } from '../vcs/Repository';
import { seedDemoRepo } from './seedDemoRepo';

test('seedDemoRepo creates 5 commits, 2 branches, and a deterministic conflict on merge', async () => {
  const storage = new InMemoryObjectStorage();
  const seeded = await seedDemoRepo(storage);
  assert.equal(seeded, true);

  // Calling again without force is a no-op
  const secondSeed = await seedDemoRepo(storage);
  assert.equal(secondSeed, false);

  const repo = new Repository(storage);
  const refs = await repo.getRefs();
  assert.equal(refs.head.type, 'branch');
  if (refs.head.type === 'branch') {
    assert.equal(refs.head.branch, 'main');
  }
  assert.ok(refs.branches['main']);
  assert.ok(refs.branches['feat/sync-protocol']);

  const allCommits = await repo.getAllCommits();
  assert.equal(allCommits.length, 5);

  const headFiles = await repo.getHeadFiles();
  const mergeRes = await repo.merge('feat/sync-protocol', headFiles);
  assert.equal(mergeRes.outcome, 'CONFLICT');
  assert.deepEqual(mergeRes.pendingMerge?.conflictedFiles, ['docs/architecture.md']);
  assert.ok(mergeRes.files['specs/split-brain.md']);
});
