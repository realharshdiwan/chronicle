import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryObjectStorage } from '../cas/ObjectStore';
import { seedDemoRepo } from '../seed/seedDemoRepo';
import { Repository } from '../vcs/Repository';
import {
  InMemorySearchIndexStorage,
  RepositorySearchEngine,
  tokenizeText,
} from './SearchIndex';

test('tokenizeText splits camelCase, snake_case, and normalizes lowercase tokens', () => {
  const tokens = tokenizeText('WorkingTreeDoc sync_step_1 IndexedDB');
  assert.equal(tokens.includes('workingtreedoc'), true);
  assert.equal(tokens.includes('working'), true);
  assert.equal(tokens.includes('tree'), true);
  assert.equal(tokens.includes('doc'), true);
  assert.equal(tokens.includes('sync'), true);
  assert.equal(tokens.includes('indexeddb'), true);
});

test('RepositorySearchEngine indexes all historical and live CAS blobs incrementally', async () => {
  const cas = new InMemoryObjectStorage();
  await seedDemoRepo(cas);
  const repo = new Repository(cas);
  const indexStore = new InMemorySearchIndexStorage();
  const engine = new RepositorySearchEngine(cas, indexStore);

  const stats1 = await engine.syncIndex();
  assert.equal(stats1.indexedBlobCount, 9);
  assert.ok(stats1.tokenCount > 50);

  // Re-syncing without new blobs should be an incremental no-op
  const stats2 = await engine.syncIndex();
  assert.equal(stats2.indexedBlobCount, 9);
  assert.equal(stats2.tokenCount, stats1.tokenCount);

  // Search for a phrase that ONLY existed in commit #1 (historical overwritten blob)
  const refs = await repo.getRefs();
  const headFiles = await repo.getHeadFiles();
  const historicalMatches = await engine.search({
    query: 'last-writer-wins',
    refs,
    workingTreeFiles: headFiles,
    scope: 'all',
  });

  assert.ok(historicalMatches.length >= 1);
  assert.equal(
    historicalMatches[0].occurrences.some(
      (o) => o.source === 'commit' && o.path === 'docs/architecture.md'
    ),
    true
  );

  // Restricting scope to working-tree omits overwritten historical blobs
  const liveOnlyMatches = await engine.search({
    query: 'last-writer-wins',
    refs,
    workingTreeFiles: headFiles,
    scope: 'working-tree',
  });
  assert.equal(liveOnlyMatches.length, 0);
});

test('RepositorySearchEngine supports prefix search and uncommitted working tree edits', async () => {
  const cas = new InMemoryObjectStorage();
  await seedDemoRepo(cas);
  const repo = new Repository(cas);
  const indexStore = new InMemorySearchIndexStorage();
  const engine = new RepositorySearchEngine(cas, indexStore);

  const refs = await repo.getRefs();
  const headFiles = await repo.getHeadFiles();

  // Prefix search (`dedup` matches `deduplication` / `deduplicated`)
  const prefixResults = await engine.search({
    query: 'dedup',
    refs,
    workingTreeFiles: headFiles,
    scope: 'all',
  });
  assert.ok(prefixResults.length >= 1);
  assert.ok(prefixResults[0].snippets.length >= 1);

  // Uncommitted working tree edit is immediately searchable
  const dirtyFiles = {
    ...headFiles,
    'notes/draft.md': '# Draft\n\nQuantum telemetry protocol notes.',
  };
  const draftResults = await engine.search({
    query: 'quantum',
    refs,
    workingTreeFiles: dirtyFiles,
    scope: 'all',
  });
  assert.equal(draftResults.length, 1);
  assert.equal(draftResults[0].occurrences[0].path, 'notes/draft.md');
  assert.equal(draftResults[0].snippets[0].lineNumber, 3);
});
