import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryObjectStorage } from '../cas/ObjectStore';
import { findLCA, isAncestor } from './dag';
import { diffFileMaps } from './diff';
import {
  hasConflictMarkers,
  parseConflictRegions,
  resolveConflictRegion,
} from './merge/conflictParser';
import { threeWayMergeFiles } from './merge/threeWayMerge';
import {
  DirtyWorkingTreeError,
  Repository,
  UnmergedBranchError,
} from './Repository';

test('Repository enforces dirty working tree protection on checkout and merge', async () => {
  const storage = new InMemoryObjectStorage();
  const repo = new Repository(storage);
  await repo.init({ 'a.md': 'hello' }, 'Tester', 'init', 1000);
  await repo.createBranch('feature');

  await assert.rejects(
    () => repo.checkout('feature', { 'a.md': 'dirty' }),
    DirtyWorkingTreeError
  );

  await assert.rejects(
    () => repo.merge('feature', { 'a.md': 'dirty' }),
    DirtyWorkingTreeError
  );
});

test('Repository handles fast-forward, clean non-overlapping 3-way merge, and conflict resolution', async () => {
  const storage = new InMemoryObjectStorage();
  const repo = new Repository(storage);

  const baseDoc = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n');
  await repo.init({ 'doc.md': baseDoc, 'shared.md': 'v1' }, 'Tester', 'root', 1000);

  await repo.createBranch('feat');

  // Edit top on main
  const mainDoc = ['line 1-main', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n');
  await repo.commit({ 'doc.md': mainDoc, 'shared.md': 'v1' }, 'main edit', 'Tester', undefined, 2000);

  // Checkout feat and edit bottom cleanly
  const featCheckout = await repo.checkout('feat', { 'doc.md': mainDoc, 'shared.md': 'v1' });
  const featDoc = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5-feat'].join('\n');
  await repo.commit(
    { ...featCheckout.files, 'doc.md': featDoc, 'added.md': 'new file' },
    'feat edit',
    'Tester',
    undefined,
    3000
  );

  // Switch back to main and merge feat -> should MERGED_CLEAN
  await repo.checkout('main', { 'doc.md': featDoc, 'shared.md': 'v1', 'added.md': 'new file' });
  const mergeClean = await repo.merge(
    'feat',
    { 'doc.md': mainDoc, 'shared.md': 'v1' },
    'Tester',
    null,
    4000
  );

  assert.equal(mergeClean.outcome, 'MERGED_CLEAN');
  assert.equal(
    mergeClean.files['doc.md'],
    ['line 1-main', 'line 2', 'line 3', 'line 4', 'line 5-feat'].join('\n')
  );
  assert.equal(mergeClean.files['added.md'], 'new file');
  assert.equal(mergeClean.commit?.parentHashes.length, 2);
});

test('3-way merge conflict markers parse and resolve cleanly for ours, theirs, and both', () => {
  const res = threeWayMergeFiles(
    { 'a.md': 'alpha\nbeta\ngamma' },
    { 'a.md': 'alpha\nbeta-ours\ngamma' },
    { 'a.md': 'alpha\nbeta-theirs\ngamma' },
    'feat/sync'
  );

  assert.equal(res.clean, false);
  assert.deepEqual(res.conflictedFiles, ['a.md']);
  assert.equal(hasConflictMarkers(res.mergedFiles['a.md']), true);

  const regions = parseConflictRegions(res.mergedFiles['a.md']);
  assert.equal(regions.length, 1);
  assert.deepEqual(regions[0].oursLines, ['beta-ours']);
  assert.deepEqual(regions[0].theirsLines, ['beta-theirs']);
  assert.equal(regions[0].theirsLabel, 'feat/sync');

  const resolvedOurs = resolveConflictRegion(res.mergedFiles['a.md'], 0, 'ours');
  assert.equal(hasConflictMarkers(resolvedOurs), false);
  assert.equal(resolvedOurs, 'alpha\nbeta-ours\ngamma');

  const resolvedBoth = resolveConflictRegion(res.mergedFiles['a.md'], 0, 'both');
  assert.equal(resolvedBoth, 'alpha\nbeta-ours\nbeta-theirs\ngamma');
});

test('findLCA handles diamond and criss-cross DAGs deterministically', async () => {
  const storage = new InMemoryObjectStorage();
  const repo = new Repository(storage);
  const c0 = await repo.init({ 'f.md': '0' }, 'A', 'c0', 1000);
  await repo.createBranch('b', c0.hash);

  const c1 = await repo.commit({ 'f.md': '1' }, 'c1', 'A', undefined, 2000);
  const bFiles = (await repo.checkout('b', { 'f.md': '1' })).files;
  const c2 = await repo.commit({ ...bFiles, 'f.md': '2' }, 'c2', 'A', undefined, 3000);

  assert.equal(await isAncestor(storage, c0.hash, c1.hash), true);
  assert.equal(await isAncestor(storage, c0.hash, c2.hash), true);
  assert.equal(await isAncestor(storage, c1.hash, c2.hash), false);

  const lca = await findLCA(storage, c1.hash, c2.hash);
  assert.equal(lca, c0.hash);
});

test('diffFileMaps accurately classifies added, modified, and deleted files', () => {
  const diffs = diffFileMaps(
    { 'a.md': 'old\nline', 'del.md': 'gone', 'same.md': 'ok' },
    { 'a.md': 'new\nline', 'add.md': 'fresh', 'same.md': 'ok' }
  );
  assert.equal(diffs.length, 3);
  assert.deepEqual(
    diffs.map((d) => [d.path, d.status]),
    [
      ['a.md', 'modified'],
      ['add.md', 'added'],
      ['del.md', 'deleted'],
    ]
  );
});

test('Repository.deleteBranch enforces active branch, unmerged guard, and force delete', async () => {
  const storage = new InMemoryObjectStorage();
  const repo = new Repository(storage);
  await repo.init({ 'a.md': 'v1' }, 'Tester', 'root', 1000);
  await repo.createBranch('merged-branch');
  await repo.createBranch('unmerged-branch');

  // Cannot delete active branch
  await assert.rejects(() => repo.deleteBranch('main'), /active branch/);

  // Merged branch deletes cleanly without force
  const afterMergedDel = await repo.deleteBranch('merged-branch');
  assert.equal(afterMergedDel.branches['merged-branch'], undefined);

  // Add commit on unmerged-branch
  const checkoutRes = await repo.checkout('unmerged-branch', { 'a.md': 'v1' });
  await repo.commit(
    { ...checkoutRes.files, 'extra.md': 'wip' },
    'unmerged work',
    'Tester',
    undefined,
    2000
  );
  await repo.checkout('main', { ...checkoutRes.files, 'extra.md': 'wip' });

  // Refuses delete without force
  await assert.rejects(
    () => repo.deleteBranch('unmerged-branch'),
    UnmergedBranchError
  );

  // Force delete succeeds
  const afterForce = await repo.deleteBranch('unmerged-branch', true);
  assert.equal(afterForce.branches['unmerged-branch'], undefined);
});
