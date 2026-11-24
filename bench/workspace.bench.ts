/**
 * Workspace benchmarks.
 *
 * Run with `npm run bench`. Vitest's benchmark project is separate from the
 * unit-test glob, so `npm test` never pays for this setup.
 *
 * Three workloads map to the three hot paths in the architecture:
 *   1. 1,000 sequential editor transactions against one Y.Text.
 *   2. SHA-256 content addressing for a 100-file tree snapshot.
 *   3. LCA discovery + three-way file merge across a 50-commit DAG.
 */

import { Doc, Text as YText } from "yjs";
import { beforeAll, test } from "vitest";

import type { IObjectStorage } from "../src/core/cas/ObjectStore";
import { InMemoryObjectStorage } from "../src/core/cas/ObjectStore";
import { hashObjectPayload, utf8ByteLength } from "../src/core/cas/hash";
import { LOCAL_EDIT_ORIGIN } from "../src/core/crdt/undo";
import { threeWayMerge } from "../src/core/merge/threeWayMerge";
import type { Sha256Hash } from "../src/core/types";
import { findLCA } from "../src/core/vcs/dag";
import { loadTreeFiles } from "../src/core/vcs/diff";
import type { IWorkingTree } from "../src/core/vcs/Repository";
import { Repository } from "../src/core/vcs/Repository";

const EDIT_COUNT = 1_000;
const FILE_COUNT = 100;
const MAIN_COMMITS = 30;
const FEATURE_COMMITS = 20;
const BASE_LINE_COUNT = 200;

class BenchWorkingTree implements IWorkingTree {
  files: Record<string, string> = {};

  readFiles(): Record<string, string> {
    return { ...this.files };
  }

  hydrateFromTree(files: Readonly<Record<string, string>>): void {
    this.files = { ...files };
  }
}

interface DagFixture {
  storage: IObjectStorage;
  mainHead: Sha256Hash;
  featureHead: Sha256Hash;
  commitCount: number;
}

let dag: DagFixture;

const hashFiles = new Map<string, string>(
  Array.from({ length: FILE_COUNT }, (_, index) => [
    `docs/bench-${String(index).padStart(3, "0")}.md`,
    `# Benchmark document ${index}\n\n${"content line\n".repeat(40)}`,
  ]),
);

beforeAll(async () => {
  const storage = new InMemoryObjectStorage();
  const workingTree = new BenchWorkingTree();
  let tick = 0;

  const repo = new Repository({
    storage,
    workingTree,
    author: "Benchmark",
    now: () => 1_700_000_000_000 + tick++ * 1_000,
  });

  const lines = Array.from(
    { length: BASE_LINE_COUNT },
    (_, index) => `line ${index}`,
  );

  const writeLines = () => {
    workingTree.files = { "notes.md": `${lines.join("\n")}\n` };
  };

  writeLines();
  await repo.commit({ message: "commit 1" });

  for (let index = 1; index <= MAIN_COMMITS - 1; index += 1) {
    lines[100 + index] = `main-${index}`;
    writeLines();
    await repo.commit({ message: `main commit ${index + 1}` });

    // Branch after the twentieth main commit. The remaining ten main commits
    // edit lines 121-130, while the feature branch edits lines 1-20.
    if (index + 1 === 20) {
      await repo.createBranch("feat/bench");
    }
  }

  await repo.checkout("feat/bench");

  for (let index = 1; index <= FEATURE_COMMITS; index += 1) {
    lines[index] = `feature-${index}`;
    writeLines();
    await repo.commit({ message: `feature commit ${index}` });
  }

  const refs = await storage.getRefs();
  const mainHead = refs?.branches.main;
  const featureHead = refs?.branches["feat/bench"];
  if (!mainHead || !featureHead) {
    throw new Error("Benchmark DAG did not seed both branch heads");
  }

  dag = {
    storage,
    mainHead,
    featureHead,
    commitCount: MAIN_COMMITS + FEATURE_COMMITS,
  };
});

test("workspace hot paths", async ({ bench }) => {
  const doc = new Doc();
  const text = new YText();
  doc.getMap<YText>("files").set("bench.md", text);

  const sequentialEdits = await bench(
    "1,000 sequential Y.Text edits",
    () => {
      text.delete(0, text.length);
      for (let index = 0; index < EDIT_COUNT; index += 1) {
        doc.transact(() => {
          text.insert(text.length, `line ${index}\n`);
        }, LOCAL_EDIT_ORIGIN);
      }
    },
  ).run();

  const treeHashing = await bench(
    "SHA-256 tree hashing (100 files)",
    async () => {
      const entries: Record<string, Sha256Hash> = {};
      for (const [path, content] of hashFiles) {
        entries[path] = await hashObjectPayload({
          type: "blob",
          content,
          byteLength: utf8ByteLength(content),
        });
      }
      await hashObjectPayload({ type: "tree", entries });
    },
  ).run();

  const mergeResolution = await bench(
    "LCA + 3-way merge (50-commit DAG)",
    async () => {
      const base = await findLCA(
        dag.storage,
        dag.mainHead,
        dag.featureHead,
      );
      if (!base) throw new Error("Benchmark DAG has no common ancestor");

      const [baseFiles, oursFiles, theirsFiles] = await Promise.all([
        loadTreeFiles(dag.storage, base.treeHash),
        loadTreeFiles(dag.storage, dag.mainHead),
        loadTreeFiles(dag.storage, dag.featureHead),
      ]);

      const result = threeWayMerge(baseFiles, oursFiles, theirsFiles, {
        oursLabel: "main",
        theirsLabel: "feat/bench",
      });
      if (result.hasConflicts) {
        throw new Error("Benchmark merge unexpectedly conflicted");
      }
    },
  ).run();

  for (const result of [sequentialEdits, treeHashing, mergeResolution]) {
    console.log(
      `[bench] ${result.name}: ${result.latency.mean.toFixed(3)} ms/iteration ` +
        `(${result.throughput.mean.toFixed(2)} ops/s)`,
    );
  }

  console.log(
    `[bench] DAG fixture: ${dag.commitCount} commits, main=${dag.mainHead.slice(0, 7)}, feature=${dag.featureHead.slice(0, 7)}`,
  );
});
