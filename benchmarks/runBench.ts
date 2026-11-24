import * as Y from 'yjs';
import { WorkingTreeDoc } from '../src/core/crdt/WorkingTreeDoc';
import { LOCAL_EDIT_ORIGIN } from '../src/core/crdt/origins';
import { createBlobObject, createTreeObject } from '../src/core/cas/hash';
import { InMemoryObjectStorage } from '../src/core/cas/ObjectStore';
import { computeStorageTelemetry } from '../src/core/cas/telemetry';
import { findLCA } from '../src/core/vcs/dag';
import { threeWayMergeFiles } from '../src/core/vcs/merge/threeWayMerge';
import {
  InMemorySearchIndexStorage,
  RepositorySearchEngine,
} from '../src/core/search/SearchIndex';

interface BenchResult {
  name: string;
  workload: string;
  mean: number;
  p50: number;
  p95: number;
  throughput: number;
  extra?: string;
}

function computeStats(samples: number[], opsPerRun = 1): Omit<BenchResult, 'name' | 'workload' | 'extra'> {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = sum / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const throughput = mean > 0 ? (1000 / mean) * opsPerRun : 0;
  return { mean, p50, p95, throughput };
}

// ---------------------------------------------------------------------------
// 1. CRDT Working Tree Benchmark
// ---------------------------------------------------------------------------
async function benchCrdt(): Promise<BenchResult> {
  const WARMUP_RUNS = 5;
  const MEASURE_RUNS = 20;
  const SAMPLES: number[] = [];

  const runIteration = () => {
    const tree = new WorkingTreeDoc({ enablePersistence: false });
    const ytext = tree.doc.getText('file:bench-note.md');

    const t0 = performance.now();
    tree.doc.transact(() => {
      for (let i = 0; i < 500; i++) {
        ytext.insert(ytext.length, `char-${i % 10} `);
      }
      for (let i = 0; i < 500; i++) {
        ytext.delete(0, 1);
      }
    }, LOCAL_EDIT_ORIGIN);

    // State-vector encoding latency
    const _sv = Y.encodeStateVector(tree.doc);
    const t1 = performance.now();
    tree.destroy();
    return t1 - t0;
  };

  for (let i = 0; i < WARMUP_RUNS; i++) runIteration();
  for (let i = 0; i < MEASURE_RUNS; i++) {
    SAMPLES.push(runIteration());
  }

  const stats = computeStats(SAMPLES);
  return {
    name: 'CRDT Working Tree',
    workload: '1,000 sequential inserts/deletes in WorkingTreeDoc + state vector',
    ...stats,
  };
}

// ---------------------------------------------------------------------------
// 2. Content-Addressable Storage Benchmark
// ---------------------------------------------------------------------------
async function benchCas(): Promise<BenchResult> {
  const WARMUP_RUNS = 5;
  const MEASURE_RUNS = 20;
  const SAMPLES: number[] = [];

  // Generate 50 workspace files with intentional duplication
  const fileTemplates: Array<{ path: string; content: string }> = [];
  const sharedBoilerplate = '# Common Architecture Header\nShared module specifications across all micro-services.\n';
  for (let i = 0; i < 50; i++) {
    // Every 5th file shares identical content to exercise deduplication
    const content = i % 5 === 0
      ? sharedBoilerplate
      : `# File ${i}\nUnique markdown section payload with randomized token-${i * 137}.\n${sharedBoilerplate.repeat(2)}`;
    fileTemplates.push({ path: `src/docs/file_${i}.md`, content });
  }

  let finalDedupRatio = 1;

  const runIteration = async () => {
    const storage = new InMemoryObjectStorage();
    const t0 = performance.now();

    const entries: Record<string, string> = {};
    for (const f of fileTemplates) {
      const blob = await createBlobObject(f.content);
      await storage.putObject(blob);
      entries[f.path] = blob.hash;
    }

    const tree = await createTreeObject(entries);
    await storage.putObject(tree);

    const { createCommitObject } = await import('../src/core/cas/hash');
    const commit = await createCommitObject({
      treeHash: tree.hash,
      parentHashes: [],
      author: 'Chronicle CAS Bench <bench@chronicle.local>',
      timestamp: Date.now(),
      message: 'Workspace snapshot',
    });
    await storage.putObject(commit);

    const t1 = performance.now();
    const telemetry = await computeStorageTelemetry(storage, t1 - t0, [t1 - t0]);
    finalDedupRatio = telemetry.deduplicationRatio;
    return t1 - t0;
  };

  for (let i = 0; i < WARMUP_RUNS; i++) await runIteration();
  for (let i = 0; i < MEASURE_RUNS; i++) {
    SAMPLES.push(await runIteration());
  }

  const stats = computeStats(SAMPLES);
  return {
    name: 'Content-Addressable Storage',
    workload: 'SHA-256 blob & tree hashing (50-file workspace)',
    ...stats,
    extra: `Dedup Ratio: ${finalDedupRatio.toFixed(2)}x`,
  };
}

// ---------------------------------------------------------------------------
// 3. Merkle-DAG & 3-Way Merge Benchmark
// ---------------------------------------------------------------------------
async function benchDagAndMerge(): Promise<BenchResult> {
  const WARMUP_RUNS = 5;
  const MEASURE_RUNS = 30;
  const SAMPLES: number[] = [];

  // Construct a 50-commit branching Merkle-DAG:
  // Base commit (c0) -> 30 commits on main (c1..c30)
  // Branch off c15 -> 20 commits on feature (f1..f20)
  const storage = new InMemoryObjectStorage();

  const makeCommit = async (
    msg: string,
    parents: string[],
    files: Record<string, string>
  ): Promise<string> => {
    const entries: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      const blob = await createBlobObject(content);
      await storage.putObject(blob);
      entries[path] = blob.hash;
    }
    const tree = await createTreeObject(entries);
    await storage.putObject(tree);
    const { createCommitObject } = await import('../src/core/cas/hash');
    const commit = await createCommitObject({
      treeHash: tree.hash,
      parentHashes: parents,
      author: 'Chronicle Bench <bench@chronicle.local>',
      timestamp: Date.now(),
      message: msg,
    });
    await storage.putObject(commit);
    return commit.hash;
  };

  const initialFiles: Record<string, string> = {
    'docs/arch.md': 'Initial architecture\nLine 2\nLine 3\n',
    'src/index.ts': 'export const v = 1;\n',
  };

  let prevHash = await makeCommit('c0: initial', [], initialFiles);
  let lcaHash = prevHash;

  for (let i = 1; i <= 30; i++) {
    prevHash = await makeCommit(`c${i}: main commit`, [prevHash], {
      'docs/arch.md': `Initial architecture\nLine 2 (main edit ${i})\nLine 3\n`,
      'src/index.ts': `export const v = ${i};\n`,
    });
    if (i === 15) {
      lcaHash = prevHash;
    }
  }
  const mainHead = prevHash;

  let featHash = lcaHash;
  for (let i = 1; i <= 20; i++) {
    featHash = await makeCommit(`f${i}: feat commit`, [featHash], {
      'docs/arch.md': `Initial architecture\nLine 2\nLine 3 (feat edit ${i})\n`,
      'src/feat.ts': `export const feat = ${i};\n`,
    });
  }
  const featHead = featHash;

  const baseFiles = {
    'docs/arch.md': 'Initial architecture\nLine 2\nLine 3\n',
  };
  const mainFiles = {
    'docs/arch.md': 'Initial architecture\nLine 2 (main edit 30)\nLine 3\n',
  };
  const featFiles = {
    'docs/arch.md': 'Initial architecture\nLine 2\nLine 3 (feat edit 20)\n',
  };

  const runIteration = async () => {
    const t0 = performance.now();
    // 1. Bidirectional BFS LCA traversal
    const lca = await findLCA(storage, mainHead, featHead);
    if (!lca) throw new Error('LCA failed');

    // 2. Three-way merge resolution
    const _merge = threeWayMergeFiles(baseFiles, mainFiles, featFiles, 'feature');
    const t1 = performance.now();
    return t1 - t0;
  };

  for (let i = 0; i < WARMUP_RUNS; i++) await runIteration();
  for (let i = 0; i < MEASURE_RUNS; i++) {
    SAMPLES.push(await runIteration());
  }

  const stats = computeStats(SAMPLES);
  return {
    name: 'Merkle-DAG & 3-Way Merge',
    workload: 'Bidirectional BFS LCA + 3-way merge across 50-commit DAG',
    ...stats,
  };
}

// ---------------------------------------------------------------------------
// 4. Local Full-Text Search Benchmark
// ---------------------------------------------------------------------------
async function benchSearch(): Promise<BenchResult> {
  const WARMUP_RUNS = 3;
  const MEASURE_RUNS = 15;
  const SAMPLES: number[] = [];

  // Generate 100 Markdown documents
  const docs: Array<{ path: string; content: string }> = [];
  const topics = ['CRDT', 'Merkle-DAG', 'IndexedDB', 'BroadcastChannel', 'Myers Diff', 'B-Tree', 'Vector Clocks'];
  for (let i = 0; i < 100; i++) {
    const topic = topics[i % topics.length];
    docs.push({
      path: `docs/topic_${i}_${topic.toLowerCase().replace(/[^a-z0-9]/g, '_')}.md`,
      content: `# ${topic} Deep Dive (Document ${i})\n\nChronicle utilizes local-first architecture combining ${topic} with client-side indexing.\nDistributed systems rely on deterministic conflict resolution algorithms.\nKey search terms: consensus, replication, storage, immutability, benchmark-${i}.\n`,
    });
  }

  const runIteration = async () => {
    const storage = new InMemoryObjectStorage();
    const searchStorage = new InMemorySearchIndexStorage();
    const searchEngine = new RepositorySearchEngine(storage, searchStorage);

    const t0 = performance.now();

    // Store blobs and create commit
    const entries: Record<string, string> = {};
    for (const d of docs) {
      const blob = await createBlobObject(d.content);
      await storage.putObject(blob);
      entries[d.path] = blob.hash;
    }
    const tree = await createTreeObject(entries);
    await storage.putObject(tree);
    const { createCommitObject } = await import('../src/core/cas/hash');
    const commit = await createCommitObject({
      treeHash: tree.hash,
      parentHashes: [],
      author: 'Chronicle Search Bench <bench@chronicle.local>',
      timestamp: Date.now(),
      message: 'Indexed 100 docs',
    });
    await storage.putObject(commit);
    await storage.setRefs({
      head: { type: 'branch', branch: 'main' },
      branches: { main: commit.hash },
    });

    // 1. Index all 100 documents
    await searchEngine.syncIndex();

    // 2. Query search index
    const refs = await storage.getRefs();
    await searchEngine.search({ query: 'distributed', refs, workingTreeFiles: {}, limit: 10 });
    await searchEngine.search({ query: 'CRDT', refs, workingTreeFiles: {}, limit: 10 });
    await searchEngine.search({ query: 'immutability', refs, workingTreeFiles: {}, limit: 10 });

    const t1 = performance.now();
    return t1 - t0;
  };

  for (let i = 0; i < WARMUP_RUNS; i++) await runIteration();
  for (let i = 0; i < MEASURE_RUNS; i++) {
    SAMPLES.push(await runIteration());
  }

  const stats = computeStats(SAMPLES);
  return {
    name: 'Local Full-Text Search',
    workload: 'Indexing & querying 100 Markdown documents in SearchIndex',
    ...stats,
  };
}

// ---------------------------------------------------------------------------
// Main Runner
// ---------------------------------------------------------------------------
async function main() {
  console.log('\n========================================================================');
  console.log(' Chronicle Benchmark Suite (Pure Core Subsystems in Isolation)');
  console.log('========================================================================\n');

  console.log('Benchmarking CRDT Working Tree...');
  const crdt = await benchCrdt();

  console.log('Benchmarking Content-Addressable Storage...');
  const cas = await benchCas();

  console.log('Benchmarking Merkle-DAG & 3-Way Merge...');
  const dag = await benchDagAndMerge();

  console.log('Benchmarking Local Full-Text Search...');
  const search = await benchSearch();

  const results = [crdt, cas, dag, search];

  console.log('\n' + '-'.repeat(96));
  console.log(
    '| ' +
    'Benchmark Subsystem'.padEnd(28) +
    ' | ' +
    'p50'.padStart(9) +
    ' | ' +
    'p95'.padStart(9) +
    ' | ' +
    'Mean'.padStart(9) +
    ' | ' +
    'Throughput'.padStart(14) +
    ' | ' +
    'Notes'.padEnd(14) +
    ' |'
  );
  console.log('-'.repeat(96));

  for (const r of results) {
    console.log(
      '| ' +
      r.name.padEnd(28) +
      ' | ' +
      `${r.p50.toFixed(2)} ms`.padStart(9) +
      ' | ' +
      `${r.p95.toFixed(2)} ms`.padStart(9) +
      ' | ' +
      `${r.mean.toFixed(2)} ms`.padStart(9) +
      ' | ' +
      `${Math.round(r.throughput).toLocaleString()} ops/s`.padStart(14) +
      ' | ' +
      (r.extra ?? '-').padEnd(14) +
      ' |'
    );
  }
  console.log('-'.repeat(96) + '\n');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
