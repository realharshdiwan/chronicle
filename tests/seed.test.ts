import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { InMemoryObjectStorage } from "../src/core/cas/ObjectStore";
import { computeStorageTelemetry } from "../src/core/cas/telemetry";
import { WorkingTreeDoc } from "../src/core/crdt/WorkingTreeDoc";
import { resolveConflictMarkers } from "../src/core/merge/conflictParser";
import {
  DEMO_CONFLICT_PATH,
  DEMO_FEATURE_BRANCH,
  DEMO_MAIN_BRANCH,
  seedDemoRepo,
} from "../src/core/seed/seedDemoRepo";
import { findLCA, getCommitHistory } from "../src/core/vcs/dag";
import { Repository } from "../src/core/vcs/Repository";
import type { IObjectStorage } from "../src/core/cas/ObjectStore";

interface SeedHarness {
  storage: IObjectStorage;
  workingTree: WorkingTreeDoc;
  repo: Repository;
}

function createHarness(): SeedHarness {
  const storage = new InMemoryObjectStorage();
  const workingTree = new WorkingTreeDoc({ persist: false });
  let tick = 0;
  const repo = new Repository({
    storage,
    workingTree,
    author: "Seed Test",
    now: () => 1_700_000_000_000 + tick++ * 1_000,
  });
  return { storage, workingTree, repo };
}

async function seed(harness: SeedHarness, force = false) {
  return seedDemoRepo({
    storage: harness.storage,
    workingTree: harness.workingTree,
    author: "Seed Test",
    force,
    now: (() => {
      let tick = 0;
      return () => 1_700_000_000_000 + tick++ * 1_000;
    })(),
  });
}

async function headHash(storage: IObjectStorage, branch: string) {
  const refs = await storage.getRefs();
  const hash = refs?.branches[branch];
  if (!hash) throw new Error(`Missing branch ${branch}`);
  return hash;
}

describe("seedDemoRepo", () => {
  it("seeds a clean five-commit, two-branch demo DAG", async () => {
    const harness = createHarness();
    const result = await seed(harness);

    expect(result.seeded).toBe(true);
    expect(result.commits).not.toBeNull();

    const refs = await harness.storage.getRefs();
    expect(refs).not.toBeNull();
    expect(refs?.head).toEqual({ type: "branch", name: DEMO_MAIN_BRANCH });
    expect(Object.keys(refs?.branches ?? {}).sort()).toEqual([
      DEMO_FEATURE_BRANCH,
      DEMO_MAIN_BRANCH,
    ]);

    const mainHead = await headHash(harness.storage, DEMO_MAIN_BRANCH);
    const featureHead = await headHash(harness.storage, DEMO_FEATURE_BRANCH);

    const mainHistory = await getCommitHistory(harness.storage, mainHead);
    const featureHistory = await getCommitHistory(harness.storage, featureHead);
    const allCommits = new Set([
      ...mainHistory.map((commit) => commit.hash),
      ...featureHistory.map((commit) => commit.hash),
    ]);

    expect(mainHistory).toHaveLength(4);
    expect(featureHistory).toHaveLength(3);
    expect(allCommits.size).toBe(5);

    // The feature branch diverges from the second commit, not from HEAD.
    const lca = await findLCA(harness.storage, mainHead, featureHead);
    expect(lca?.hash).toBe(result.commits?.protocol.hash);

    const status = await harness.repo.status({ includeUnmodified: false });
    expect(status).toEqual([]);

    const files = harness.workingTree.readFiles();
    expect(files).toHaveProperty("README.md");
    expect(files).toHaveProperty("docs/architecture.md");
    expect(files).toHaveProperty("docs/roadmap.md");
    expect(files).toHaveProperty("docs/sync-protocol.md");
    expect(files).not.toHaveProperty("docs/recovery.md");
    expect(files[DEMO_CONFLICT_PATH]).not.toContain("<<<<<<<");

    await harness.workingTree.destroy();
  });

  it("produces one intentional conflict when merging the feature branch", async () => {
    const harness = createHarness();
    await seed(harness);

    const outcome = await harness.repo.merge(DEMO_FEATURE_BRANCH);
    expect(outcome.status).toBe("CONFLICT");
    if (outcome.status !== "CONFLICT") return;

    expect(outcome.conflictFiles.map((file) => file.path)).toEqual([
      DEMO_CONFLICT_PATH,
    ]);
    expect(outcome.conflictFiles[0]?.mergedWithMarkers).toContain("<<<<<<<");

    const pending = harness.repo.getPendingMerge();
    expect(pending?.conflictPaths).toEqual([DEMO_CONFLICT_PATH]);

    const files = harness.workingTree.readFiles();
    expect(files[DEMO_CONFLICT_PATH]).toContain("<<<<<<<");

    files[DEMO_CONFLICT_PATH] = resolveConflictMarkers(
      files[DEMO_CONFLICT_PATH] ?? "",
      "both",
    );
    harness.workingTree.hydrateFromTree(files);

    const mergeCommit = await harness.repo.completeMergeCommit();
    expect(mergeCommit.parentHashes).toHaveLength(2);

    const status = await harness.repo.status({ includeUnmodified: false });
    expect(status).toEqual([]);
    expect(harness.repo.getPendingMerge()).toBeNull();

    const mergedHistory = await harness.repo.log();
    expect(mergedHistory[0]?.hash).toBe(mergeCommit.hash);
    expect(mergedHistory).toHaveLength(6);

    await harness.workingTree.destroy();
  });

  it("does not reseed an existing repository unless forced", async () => {
    const harness = createHarness();
    await seed(harness);
    const before = await harness.storage.listObjects();

    const second = await seed(harness);
    expect(second.seeded).toBe(false);
    expect(second.commits).toBeNull();

    const after = await harness.storage.listObjects();
    expect(after).toHaveLength(before.length);

    await harness.workingTree.destroy();
  });

  it("force-resets objects, refs, and the working tree to the fixture", async () => {
    const harness = createHarness();
    await seed(harness);

    await harness.repo.createBranch("scratch/local");
    harness.workingTree.setFile("scratch.md", "local only\n");
    await harness.repo.commit({ message: "local experiment" });

    const beforeRefs = await harness.storage.getRefs();
    expect(Object.keys(beforeRefs?.branches ?? {})).toHaveLength(3);
    expect(harness.workingTree.hasFile("scratch.md")).toBe(true);

    const result = await seed(harness, true);
    expect(result.seeded).toBe(true);
    expect(result.commits).not.toBeNull();

    const refs = await harness.storage.getRefs();
    expect(Object.keys(refs?.branches ?? {}).sort()).toEqual([
      DEMO_FEATURE_BRANCH,
      DEMO_MAIN_BRANCH,
    ]);
    expect(refs?.head).toEqual({ type: "branch", name: DEMO_MAIN_BRANCH });

    const mainHead = await headHash(harness.storage, DEMO_MAIN_BRANCH);
    const featureHead = await headHash(harness.storage, DEMO_FEATURE_BRANCH);
    const mainHistory = await getCommitHistory(harness.storage, mainHead);
    const featureHistory = await getCommitHistory(harness.storage, featureHead);

    expect(mainHistory).toHaveLength(4);
    expect(featureHistory).toHaveLength(3);
    expect(mainHistory.map((commit) => commit.message)).not.toContain(
      "local experiment",
    );

    expect(harness.workingTree.hasFile("scratch.md")).toBe(false);
    expect(harness.workingTree.readFiles()).not.toHaveProperty("scratch.md");
    expect(await harness.repo.status({ includeUnmodified: false })).toEqual([]);

    await harness.workingTree.destroy();
  });

  it("stores every file version while deduplicating identical blobs", async () => {
    const harness = createHarness();
    await seed(harness);

    const objects = await harness.storage.listObjects();
    const telemetry = computeStorageTelemetry(objects);

    expect(telemetry.commitCount).toBe(5);
    expect(telemetry.blobCount).toBeGreaterThan(0);
    expect(telemetry.treeCount).toBe(5);
    expect(telemetry.logicalBytes).toBeGreaterThan(telemetry.deduplicatedBytes);
    expect(telemetry.deduplicationRatio).toBeGreaterThan(0);
    expect(telemetry.deduplicationRatio).toBeLessThan(1);

    await harness.workingTree.destroy();
  });
});
