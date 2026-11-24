import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import { InMemoryObjectStorage, IndexedDBObjectStorage } from "../src/core/cas/ObjectStore";
import { hashObjectPayload } from "../src/core/cas/hash";
import {
  findLCA,
  getCommit,
  getCommitHistory,
  isAncestor,
} from "../src/core/vcs/dag";
import {
  diffFileMaps,
  diffTextLines,
  diffTrees,
  diffWorkingTree,
} from "../src/core/vcs/diff";
import {
  ConflictParseError,
  formatConflictBlock,
  hasConflictMarkers,
  parseConflictHunks,
  resolveConflictMarkers,
} from "../src/core/merge/conflictParser";
import { mergeText3Way, threeWayMerge } from "../src/core/merge/threeWayMerge";
import type { IWorkingTree } from "../src/core/vcs/Repository";
import { Repository } from "../src/core/vcs/Repository";
import {
  BranchAlreadyExistsError,
  DirtyWorkingTreeError,
  NothingToCommitError,
  NoPendingMergeError,
  UnresolvedConflictsError,
} from "../src/core/vcs/errors";
import type { CommitObject, MergeOutcome } from "../src/core/types";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

class MemoryWorkingTree implements IWorkingTree {
  private files: Record<string, string> = {};

  constructor(initial: Record<string, string> = {}) {
    this.files = { ...initial };
  }

  readFiles(): Record<string, string> {
    return { ...this.files };
  }

  hydrateFromTree(files: Readonly<Record<string, string>>): void {
    this.files = { ...files };
  }

  writeFile(path: string, content: string): void {
    this.files = { ...this.files, [path]: content };
  }

  deleteFile(path: string): void {
    const next = { ...this.files };
    delete next[path];
    this.files = next;
  }
}

interface Harness {
  storage: InMemoryObjectStorage;
  workingTree: MemoryWorkingTree;
  repo: Repository;
}

function createHarness(): Harness {
  const storage = new InMemoryObjectStorage();
  const workingTree = new MemoryWorkingTree();
  let tick = 0;

  const repo = new Repository({
    storage,
    workingTree,
    author: "Test Author",
    now: () => 1_700_000_000_000 + tick++,
  });

  return { storage, workingTree, repo };
}

async function createBaseRepo(content = "base\n"): Promise<
  Harness & { base: CommitObject }
> {
  const harness = createHarness();
  await harness.repo.init();
  harness.workingTree.writeFile("doc.md", content);
  const base = await harness.repo.commit({ message: "base" });
  return { ...harness, base };
}

function outcomeAs<Status extends MergeOutcome["status"]>(
  outcome: MergeOutcome,
  status: Status,
): Extract<MergeOutcome, { status: Status }> {
  expect(outcome.status).toBe(status);
  return outcome as Extract<MergeOutcome, { status: Status }>;
}

function statuses(files: Array<{ path: string; status: string }>): Record<string, string> {
  return Object.fromEntries(files.map((file) => [file.path, file.status]));
}

async function syntheticCommit(
  message: string,
  parentHashes: string[],
  timestamp: number,
): Promise<CommitObject> {
  const payload = {
    type: "commit" as const,
    treeHash: "a".repeat(64),
    parentHashes,
    message,
    author: "Synthetic",
    timestamp,
  };
  return { ...payload, hash: await hashObjectPayload(payload) };
}

// ---------------------------------------------------------------------------
// DAG traversal and LCA
// ---------------------------------------------------------------------------

describe("Merkle-DAG traversal", () => {
  it("walks linear history newest-first and respects the limit", async () => {
    const { storage, workingTree, repo } = createHarness();
    await repo.init();

    workingTree.writeFile("doc.md", "one\n");
    const first = await repo.commit({ message: "first" });
    workingTree.writeFile("doc.md", "two\n");
    const second = await repo.commit({ message: "second" });
    workingTree.writeFile("doc.md", "three\n");
    const third = await repo.commit({ message: "third" });

    const history = await getCommitHistory(storage, third.hash);
    expect(history.map((commit) => commit.message)).toEqual([
      "third",
      "second",
      "first",
    ]);
    expect(history.map((commit) => commit.hash)).toEqual([
      third.hash,
      second.hash,
      first.hash,
    ]);
    expect(second.parentHashes).toEqual([first.hash]);
    expect(first.parentHashes).toEqual([]);

    const limited = await getCommitHistory(storage, third.hash, { limit: 2 });
    expect(limited.map((commit) => commit.hash)).toEqual([
      third.hash,
      second.hash,
    ]);

    expect(await getCommitHistory(storage, third.hash, { limit: 0 })).toEqual([]);
  });

  it("detects ancestry in both directions", async () => {
    const { storage, workingTree, repo } = createHarness();
    await repo.init();

    workingTree.writeFile("doc.md", "one\n");
    const first = await repo.commit({ message: "first" });
    workingTree.writeFile("doc.md", "two\n");
    const second = await repo.commit({ message: "second" });

    expect(await isAncestor(storage, first.hash, second.hash)).toBe(true);
    expect(await isAncestor(storage, second.hash, first.hash)).toBe(false);
    expect(await isAncestor(storage, second.hash, second.hash)).toBe(true);
    expect(await isAncestor(storage, first.hash, first.hash)).toBe(true);
  });

  it("finds the merge base across diverged branches", async () => {
    const { storage, workingTree, repo, base } = await createBaseRepo();

    await repo.createBranch("feat/branch");
    await repo.checkout("feat/branch");
    workingTree.writeFile("doc.md", "feature\n");
    const feature = await repo.commit({ message: "feature change" });

    await repo.checkout("main");
    workingTree.writeFile("doc.md", "main\n");
    const main = await repo.commit({ message: "main change" });

    const lca = await findLCA(storage, main.hash, feature.hash);
    expect(lca?.hash).toBe(base.hash);

    const same = await findLCA(storage, main.hash, main.hash);
    expect(same?.hash).toBe(main.hash);
  });

  it("produces a topological order for merge commits", async () => {
    const { storage, workingTree, repo, base } = await createBaseRepo(
      "alpha\nbeta\ngamma\n",
    );

    await repo.createBranch("feat/topic");
    await repo.checkout("feat/topic");
    workingTree.writeFile("doc.md", "alpha\nFEATURE\ngamma\n");
    const feature = await repo.commit({ message: "feature" });

    await repo.checkout("main");
    workingTree.writeFile("doc.md", "MAIN\nbeta\ngamma\n");
    const main = await repo.commit({ message: "main" });

    const mergeOutcome = outcomeAs(await repo.merge("feat/topic"), "MERGED_CLEAN");
    const mergeCommit = await getCommit(storage, mergeOutcome.commitHash);

    const history = await getCommitHistory(storage, mergeCommit.hash);
    const index = new Map(history.map((commit, position) => [commit.hash, position]));

    expect(history[0]?.hash).toBe(mergeCommit.hash);
    for (const commit of history) {
      for (const parentHash of commit.parentHashes) {
        expect(index.get(parentHash)).toBeGreaterThan(index.get(commit.hash) ?? -1);
      }
    }

    const expectedHashes = new Set([
      mergeCommit.hash,
      main.hash,
      feature.hash,
      base.hash,
    ]);
    expect(new Set(history.map((commit) => commit.hash))).toEqual(expectedHashes);
  });

  it("selects a best common ancestor in a criss-cross history", async () => {
    const storage = new InMemoryObjectStorage();
    const root = await syntheticCommit("root", [], 1);
    const left = await syntheticCommit("left", [root.hash], 2);
    const right = await syntheticCommit("right", [root.hash], 3);
    const leftMerge = await syntheticCommit("left merge", [left.hash, right.hash], 4);
    const rightMerge = await syntheticCommit("right merge", [right.hash, left.hash], 5);

    await storage.putObjects([root, left, right, leftMerge, rightMerge]);

    const lca = await findLCA(storage, leftMerge.hash, rightMerge.hash);
    expect([left.hash, right.hash]).toContain(lca?.hash);
    // The root is a common ancestor too, but it is dominated by both sides.
    expect(lca?.hash).not.toBe(root.hash);

    expect(await isAncestor(storage, root.hash, leftMerge.hash)).toBe(true);
    expect(await isAncestor(storage, leftMerge.hash, rightMerge.hash)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

describe("line and file diffing", () => {
  it("classifies added, deleted, modified, and unmodified files", () => {
    const base = {
      "keep.md": "same\n",
      "mod.md": "old\n",
      "del.md": "gone\n",
    };
    const working = {
      "keep.md": "same\n",
      "mod.md": "new\n",
      "add.md": "added\n",
    };

    const all = diffFileMaps(base, working);
    expect(statuses(all)).toEqual({
      "add.md": "ADDED",
      "del.md": "DELETED",
      "keep.md": "UNMODIFIED",
      "mod.md": "MODIFIED",
    });
    expect(all.find((file) => file.path === "mod.md")).toMatchObject({
      baseContent: "old\n",
      workingContent: "new\n",
    });

    const changedOnly = diffFileMaps(base, working, {
      includeUnmodified: false,
    });
    expect(changedOnly.map((file) => file.path)).toEqual([
      "add.md",
      "del.md",
      "mod.md",
    ]);
  });

  it("uses Myers hunks to describe line changes", () => {
    const hunks = diffTextLines("one\ntwo\nthree\n", "one\nTWO\nthree\nfour\n");
    expect(hunks.some((hunk) => hunk.removed && hunk.value.includes("two"))).toBe(
      true,
    );
    expect(hunks.some((hunk) => hunk.added && hunk.value.includes("TWO"))).toBe(
      true,
    );
    expect(hunks.some((hunk) => hunk.added && hunk.value.includes("four"))).toBe(
      true,
    );
  });

  it("diffs committed trees and the live working tree", async () => {
    const { storage, workingTree, repo } = await createBaseRepo();
    workingTree.hydrateFromTree({
      "doc.md": "base\n",
      "notes.md": "notes\n",
    });
    const first = await repo.commit({ message: "two files" });

    workingTree.hydrateFromTree({
      "doc.md": "base changed\n",
      "extra.md": "extra\n",
    });
    const second = await repo.commit({ message: "modify and add" });

    workingTree.hydrateFromTree({
      "doc.md": "base changed\n",
      "extra.md": "working edit\n",
    });

    const treeDiff = await diffTrees(storage, first.hash, second.hash, {
      includeUnmodified: false,
    });
    expect(statuses(treeDiff)).toEqual({
      "doc.md": "MODIFIED",
      "extra.md": "ADDED",
      "notes.md": "DELETED",
    });

    const workingDiff = await diffWorkingTree(storage, second.hash, workingTree.readFiles(), {
      includeUnmodified: false,
    });
    expect(statuses(workingDiff)).toEqual({ "extra.md": "MODIFIED" });
  });
});

// ---------------------------------------------------------------------------
// Conflict markers
// ---------------------------------------------------------------------------

describe("conflict marker parsing and resolution", () => {
  it("round-trips generated blocks for ours, theirs, and both", () => {
    const block = formatConflictBlock(
      "main change\n",
      "feature change\n",
      "HEAD",
      "feat/x",
    );

    expect(block).toBe(
      "<<<<<<< HEAD\nmain change\n=======\nfeature change\n>>>>>>> feat/x\n",
    );
    expect(hasConflictMarkers(block)).toBe(true);

    const parsed = parseConflictHunks(block);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      oursLabel: "HEAD",
      theirsLabel: "feat/x",
      ours: "main change\n",
      theirs: "feature change\n",
    });

    expect(resolveConflictMarkers(block, "ours")).toBe("main change\n");
    expect(resolveConflictMarkers(block, "theirs")).toBe("feature change\n");
    expect(resolveConflictMarkers(block, "both")).toBe(
      "main change\nfeature change\n",
    );
  });

  it("preserves text surrounding conflict blocks", () => {
    const content = `intro\n${formatConflictBlock("ours\n", "theirs\n")}outro\n`;
    expect(resolveConflictMarkers(content, "theirs")).toBe(
      "intro\ntheirs\noutro\n",
    );
  });

  it("rejects unterminated markers", () => {
    expect(() =>
      resolveConflictMarkers("<<<<<<< HEAD\nunterminated\n", "ours"),
    ).toThrow(ConflictParseError);
  });
});

// ---------------------------------------------------------------------------
// Text + file three-way merge
// ---------------------------------------------------------------------------

describe("three-way merge", () => {
  it("auto-merges non-overlapping line edits", () => {
    const result = mergeText3Way(
      "alpha\nbeta\ngamma\ndelta\n",
      "ALPHA\nbeta\ngamma\ndelta\n",
      "alpha\nbeta\ngamma\nDELTA\n",
    );

    expect(result.hasConflicts).toBe(false);
    expect(result.content).toBe("ALPHA\nbeta\ngamma\nDELTA\n");
  });

  it("accepts identical changes made on both sides", () => {
    const result = mergeText3Way("alpha\n", "ALPHA\n", "ALPHA\n");
    expect(result.hasConflicts).toBe(false);
    expect(result.content).toBe("ALPHA\n");
  });

  it("applies a one-sided insertion", () => {
    const result = mergeText3Way("a\nb\n", "a\nnew\nb\n", "a\nb\n");
    expect(result.hasConflicts).toBe(false);
    expect(result.content).toBe("a\nnew\nb\n");
  });

  it("orders insertions cleanly next to a changed line", () => {
    const insertBefore = mergeText3Way(
      "a\nb\n",
      "a\ninserted\nb\n",
      "a\nB\n",
    );
    expect(insertBefore.hasConflicts).toBe(false);
    expect(insertBefore.content).toBe("a\ninserted\nB\n");

    const insertAfter = mergeText3Way(
      "a\nb\n",
      "a\nB\n",
      "a\nb\ntail\n",
    );
    expect(insertAfter.hasConflicts).toBe(false);
    expect(insertAfter.content).toBe("a\nB\ntail\n");
  });

  it("conflicts when both sides insert different text at the same spot", () => {
    const result = mergeText3Way("a\n", "a\nours\n", "a\ntheirs\n");
    expect(result.hasConflicts).toBe(true);
    expect(result.content).toContain("<<<<<<< HEAD\nours\n");
    expect(result.content).toContain("=======\ntheirs\n");
  });

  it("emits markers when both sides edit the same line", () => {
    const result = mergeText3Way("shared\n", "main\n", "feature\n", {
      oursLabel: "HEAD",
      theirsLabel: "feat/x",
    });

    expect(result.hasConflicts).toBe(true);
    expect(result.conflictCount).toBe(1);
    expect(result.content).toBe(
      "<<<<<<< HEAD\nmain\n=======\nfeature\n>>>>>>> feat/x\n",
    );
    expect(resolveConflictMarkers(result.content, "theirs")).toBe("feature\n");
  });

  it("handles add/add, delete/modify, and clean deletions at file level", () => {
    const addAdd = threeWayMerge(
      {},
      { "x.md": "ours\n" },
      { "x.md": "theirs\n" },
    );
    expect(addAdd.hasConflicts).toBe(true);
    expect(addAdd.conflictFiles[0]?.path).toBe("x.md");
    expect(addAdd.conflictFiles[0]?.baseContent).toBe("");
    expect(addAdd.resolvedFiles).toEqual({});

    const deleteModify = threeWayMerge(
      { "x.md": "base\n" },
      {},
      { "x.md": "modified\n" },
    );
    expect(deleteModify.hasConflicts).toBe(true);
    expect(deleteModify.conflictFiles[0]?.oursContent).toBe("");
    expect(deleteModify.conflictFiles[0]?.theirsContent).toBe("modified\n");

    const cleanDelete = threeWayMerge(
      { "x.md": "base\n" },
      {},
      { "x.md": "base\n" },
    );
    expect(cleanDelete.hasConflicts).toBe(false);
    expect(cleanDelete.resolvedFiles).toEqual({});
  });

  it("merges different files cleanly without touching the base", () => {
    const result = threeWayMerge(
      { "a.md": "a\n", "b.md": "b\n" },
      { "a.md": "a changed\n", "b.md": "b\n" },
      { "a.md": "a\n", "b.md": "b changed\n" },
    );

    expect(result.hasConflicts).toBe(false);
    expect(result.resolvedFiles).toEqual({
      "a.md": "a changed\n",
      "b.md": "b changed\n",
    });
  });
});

// ---------------------------------------------------------------------------
// Repository orchestration
// ---------------------------------------------------------------------------

describe("Repository", () => {
  it("starts with an unborn branch and creates a root commit", async () => {
    const { workingTree, repo } = createHarness();
    expect(await repo.init()).toBeNull();

    workingTree.writeFile("notes.md", "# Notes\n");
    const root = await repo.commit({ message: "initial commit" });

    expect(root.parentHashes).toEqual([]);

    const refs = await repo.getRefs();
    expect(refs).toEqual({
      head: { type: "branch", name: "main" },
      branches: { main: root.hash },
    });

    const status = await repo.status();
    expect(status).toEqual([
      {
        path: "notes.md",
        status: "UNMODIFIED",
        baseContent: "# Notes\n",
        workingContent: "# Notes\n",
      },
    ]);

    const history = await repo.log();
    expect(history.map((commit) => commit.hash)).toEqual([root.hash]);
  });

  it("rejects empty commits unless explicitly allowed", async () => {
    const { repo } = await createBaseRepo();

    await expect(repo.commit({ message: "no changes" })).rejects.toBeInstanceOf(
      NothingToCommitError,
    );

    const empty = await repo.commit({
      message: "allowed empty",
      allowEmpty: true,
    });
    expect(empty.parentHashes).toHaveLength(1);
  });

  it("creates branches and protects uncommitted work on checkout", async () => {
    const { workingTree, repo, base } = await createBaseRepo();

    const branchHead = await repo.createBranch("feat/day-two");
    expect(branchHead).toBe(base.hash);
    await expect(repo.createBranch("feat/day-two")).rejects.toBeInstanceOf(
      BranchAlreadyExistsError,
    );

    workingTree.writeFile("doc.md", "uncommitted edit\n");
    workingTree.writeFile("untracked.md", "untracked\n");

    const dirty = repo.checkout("feat/day-two");
    await expect(dirty).rejects.toBeInstanceOf(DirtyWorkingTreeError);
    await expect(dirty).rejects.toMatchObject({
      changedPaths: ["doc.md", "untracked.md"],
    });

    expect(await repo.getActiveBranch()).toBe("main");

    await repo.checkout("feat/day-two", { force: true });
    expect(await repo.getActiveBranch()).toBe("feat/day-two");
    expect(workingTree.readFiles()).toEqual({ "doc.md": "base\n" });
    expect(await repo.status({ includeUnmodified: false })).toEqual([]);
  });

  it("fast-forwards and then reports already up to date", async () => {
    const { workingTree, repo, base } = await createBaseRepo();

    await repo.createBranch("feat/fast");
    await repo.checkout("feat/fast");
    workingTree.writeFile("doc.md", "feature\n");
    const feature = await repo.commit({ message: "feature commit" });

    await repo.checkout("main");
    expect(workingTree.readFiles()).toEqual({ "doc.md": "base\n" });

    const fastForward = outcomeAs(await repo.merge("feat/fast"), "FAST_FORWARD");
    expect(fastForward.commitHash).toBe(feature.hash);
    expect((await repo.getRefs())?.branches.main).toBe(feature.hash);
    expect(workingTree.readFiles()).toEqual({ "doc.md": "feature\n" });
    expect(await repo.status({ includeUnmodified: false })).toEqual([]);

    const upToDate = await repo.merge("feat/fast");
    expect(upToDate).toEqual({ status: "ALREADY_UP_TO_DATE" });

    // History is still linear: base < feature.
    expect(await repo.log()).toHaveLength(2);
    expect(base.hash).not.toBe(feature.hash);
  });

  it("performs a clean three-way merge and records both parents", async () => {
    const { storage, workingTree, repo } = await createBaseRepo(
      "# Design\nAlpha paragraph.\nBeta paragraph.\nGamma paragraph.\n",
    );

    await repo.createBranch("feat/topic");
    await repo.checkout("feat/topic");
    workingTree.writeFile(
      "doc.md",
      "# Design\nAlpha paragraph.\nBeta paragraph, revised on feature.\nGamma paragraph.\n",
    );
    const feature = await repo.commit({ message: "feature edit" });

    await repo.checkout("main");
    workingTree.writeFile(
      "doc.md",
      "# Design\nAlpha paragraph.\nBeta paragraph.\nGamma paragraph, revised on main.\n",
    );
    const main = await repo.commit({ message: "main edit" });

    const outcome = outcomeAs(
      await repo.merge("feat/topic", { message: "Merge feat/topic" }),
      "MERGED_CLEAN",
    );

    const mergeCommit = await getCommit(storage, outcome.commitHash);
    expect(mergeCommit.parentHashes).toEqual([main.hash, feature.hash]);
    expect(mergeCommit.message).toBe("Merge feat/topic");

    expect(workingTree.readFiles()).toEqual({
      "doc.md":
        "# Design\nAlpha paragraph.\nBeta paragraph, revised on feature.\nGamma paragraph, revised on main.\n",
    });
    expect(await repo.status({ includeUnmodified: false })).toEqual([]);

    const history = await repo.log();
    expect(history[0]?.hash).toBe(mergeCommit.hash);
    expect(history.map((commit) => commit.hash)).toContain(feature.hash);
  });

  it("reports conflicts, keeps a pending merge, and resolves it", async () => {
    const { workingTree, repo } = await createBaseRepo("shared line\n");
    workingTree.writeFile("notes.md", "shared notes\n");
    const withNotes = await repo.commit({ message: "add notes" });

    await repo.createBranch("feat/conflict");
    await repo.checkout("feat/conflict");
    workingTree.writeFile("doc.md", "feature line\n");
    workingTree.writeFile("notes.md", "feature notes\n");
    const feature = await repo.commit({ message: "feature edit" });

    await repo.checkout("main");
    workingTree.writeFile("doc.md", "main line\n");
    const main = await repo.commit({ message: "main edit" });

    const outcome = outcomeAs(await repo.merge("feat/conflict"), "CONFLICT");
    expect(outcome.baseCommitHash).toBe(withNotes.hash);
    expect(outcome.sourceCommitHash).toBe(feature.hash);
    expect(outcome.sourceBranch).toBe("feat/conflict");
    expect(outcome.targetBranch).toBe("main");
    expect(outcome.conflictFiles).toHaveLength(1);
    expect(outcome.conflictFiles[0]?.path).toBe("doc.md");
    expect(outcome.conflictFiles[0]?.baseContent).toBe("shared line\n");
    expect(outcome.conflictFiles[0]?.oursContent).toBe("main line\n");
    expect(outcome.conflictFiles[0]?.theirsContent).toBe("feature line\n");

    const markers = outcome.conflictFiles[0]?.mergedWithMarkers ?? "";
    expect(markers).toContain("<<<<<<< HEAD\nmain line\n");
    expect(markers).toContain("=======\nfeature line\n");
    expect(markers).toContain(">>>>>>> feat/conflict\n");

    expect(outcome.resolvedFiles["notes.md"]).toBe("feature notes\n");
    expect(workingTree.readFiles()["notes.md"]).toBe("feature notes\n");
    expect(workingTree.readFiles()["doc.md"]).toBe(markers);

    const pending = repo.getPendingMerge();
    expect(pending?.sourceBranch).toBe("feat/conflict");
    expect(pending?.targetCommitHash).toBe(main.hash);

    await expect(repo.completeMergeCommit()).rejects.toBeInstanceOf(
      UnresolvedConflictsError,
    );
    // A normal commit is blocked until the merge completes.
    await expect(repo.commit({ message: "sneaky" })).rejects.toThrow(
      /merge is in progress/i,
    );

    const resolvedDoc = resolveConflictMarkers(markers, "theirs");
    const finalFiles = {
      ...outcome.resolvedFiles,
      "doc.md": resolvedDoc,
    };

    const mergeCommit = await repo.completeMergeCommit({ files: finalFiles });
    expect(mergeCommit.parentHashes).toEqual([main.hash, feature.hash]);
    expect(await repo.getPendingMerge()).toBeNull();
    expect((await repo.getRefs())?.branches.main).toBe(mergeCommit.hash);
    expect(workingTree.readFiles()).toEqual(finalFiles);
    expect(await repo.status({ includeUnmodified: false })).toEqual([]);

    const alreadyMerged = await repo.merge("feat/conflict");
    expect(alreadyMerged).toEqual({ status: "ALREADY_UP_TO_DATE" });
  });

  it("can abort a conflicted merge and restore the target tree", async () => {
    const { workingTree, repo } = await createBaseRepo("shared\n");

    await repo.createBranch("feat/abort");
    await repo.checkout("feat/abort");
    workingTree.writeFile("doc.md", "feature\n");
    await repo.commit({ message: "feature" });

    await repo.checkout("main");
    workingTree.writeFile("doc.md", "main\n");
    const main = await repo.commit({ message: "main" });

    outcomeAs(await repo.merge("feat/abort"), "CONFLICT");
    expect(workingTree.readFiles()["doc.md"]).toContain("<<<<<<< HEAD");

    await repo.abortMerge();
    expect(repo.getPendingMerge()).toBeNull();
    expect(workingTree.readFiles()).toEqual({ "doc.md": "main\n" });
    expect((await repo.getRefs())?.branches.main).toBe(main.hash);
    expect(await repo.status({ includeUnmodified: false })).toEqual([]);

    await expect(repo.abortMerge()).rejects.toBeInstanceOf(NoPendingMergeError);
  });

  it("refuses to merge or check out over a dirty working tree", async () => {
    const { workingTree, repo } = await createBaseRepo("base\n");

    await repo.createBranch("feat/dirty");
    await repo.checkout("feat/dirty");
    workingTree.writeFile("doc.md", "feature\n");
    const feature = await repo.commit({ message: "feature" });

    await repo.checkout("main");
    workingTree.writeFile("doc.md", "uncommitted\n");

    const mergeAttempt = repo.merge("feat/dirty");
    await expect(mergeAttempt).rejects.toBeInstanceOf(DirtyWorkingTreeError);
    await expect(mergeAttempt).rejects.toMatchObject({
      changedPaths: ["doc.md"],
    });

    expect((await repo.getRefs())?.branches.main).not.toBe(feature.hash);
    expect((await repo.getRefs())?.branches.main).toBeDefined();
    expect(workingTree.readFiles()).toEqual({ "doc.md": "uncommitted\n" });

    await repo.merge("feat/dirty", { force: true });
    expect(workingTree.readFiles()).toEqual({ "doc.md": "feature\n" });
  });

  it("classifies working-tree changes and supports soft/hard reset", async () => {
    const { workingTree, repo, base } = await createBaseRepo("one\n");
    workingTree.writeFile("delete.md", "delete me\n");
    workingTree.writeFile("modify.md", "before\n");
    const second = await repo.commit({ message: "second" });

    workingTree.writeFile("doc.md", "modified\n");

    const status = await repo.status({ includeUnmodified: false });
    expect(statuses(status)).toEqual({ "doc.md": "MODIFIED" });

    await repo.reset(base.hash, { hard: true });
    expect((await repo.getRefs())?.branches.main).toBe(base.hash);
    expect(workingTree.readFiles()).toEqual({ "doc.md": "one\n" });
    expect(await repo.status({ includeUnmodified: false })).toEqual([]);

    await repo.reset(second.hash);
    expect((await repo.getRefs())?.branches.main).toBe(second.hash);
    expect(workingTree.readFiles()).toEqual({ "doc.md": "one\n" });
    expect(statuses(await repo.status({ includeUnmodified: false }))).toEqual({
      "delete.md": "DELETED",
      "modify.md": "DELETED",
    });
  });
});

// ---------------------------------------------------------------------------
// Integration with the durable object store
// ---------------------------------------------------------------------------

describe("Repository + IndexedDB", () => {
  it("persists commits and branches across store reopen", async () => {
    const dbName = `chronicle-repo-test-${crypto.randomUUID()}`;
    const workingTree = new MemoryWorkingTree({ "doc.md": "durable\n" });
    let tick = 0;

    const firstStore = new IndexedDBObjectStorage({ dbName });
    const firstRepo = new Repository({
      storage: firstStore,
      workingTree,
      author: "Disk Author",
      now: () => 1_700_000_000_000 + tick++,
    });
    const root = await firstRepo.commit({ message: "root" });
    await firstRepo.createBranch("feat/durable");
    await firstStore.close();

    const secondStore = new IndexedDBObjectStorage({ dbName });
    const secondWorkingTree = new MemoryWorkingTree();
    const secondRepo = new Repository({
      storage: secondStore,
      workingTree: secondWorkingTree,
      author: "Disk Author",
      now: () => 1_700_000_000_000 + tick++,
    });

    const refs = await secondRepo.init();
    expect(refs?.branches.main).toBe(root.hash);
    expect(refs?.branches["feat/durable"]).toBe(root.hash);

    await secondRepo.checkout("main", { force: true });
    expect(secondWorkingTree.readFiles()).toEqual({ "doc.md": "durable\n" });
    expect(await secondRepo.log()).toHaveLength(1);

    await secondStore.clear();
    await secondStore.close();
  });
});
