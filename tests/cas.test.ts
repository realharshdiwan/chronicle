import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canonicalStringify,
  CanonicalSerializationError,
  hashObjectPayload,
  sha256Hex,
  utf8ByteLength,
} from "../src/core/cas/hash";
import type { HashableObjectPayload } from "../src/core/cas/hash";
import {
  IndexedDBObjectStorage,
  InMemoryObjectStorage,
  InvalidRefStateError,
  ObjectIntegrityError,
} from "../src/core/cas/ObjectStore";
import type { IObjectStorage } from "../src/core/cas/ObjectStore";
import { computeStorageTelemetry } from "../src/core/cas/telemetry";
import type {
  BlobObject,
  CommitObject,
  RefState,
  Sha256Hash,
  TreeObject,
} from "../src/core/types";

// ---------------------------------------------------------------------------
// Fixtures: build real, correctly addressed objects through the public hash API
// ---------------------------------------------------------------------------

async function makeBlob(content: string): Promise<BlobObject> {
  const payload = {
    type: "blob" as const,
    content,
    byteLength: utf8ByteLength(content),
  };
  return { ...payload, hash: await hashObjectPayload(payload) };
}

async function makeTree(
  entries: Record<string, Sha256Hash>,
): Promise<TreeObject> {
  const payload = { type: "tree" as const, entries };
  return { ...payload, hash: await hashObjectPayload(payload) };
}

async function makeCommit(input: {
  treeHash: Sha256Hash;
  parentHashes?: Sha256Hash[];
  message?: string;
  author?: string;
  timestamp?: number;
}): Promise<CommitObject> {
  const payload = {
    type: "commit" as const,
    treeHash: input.treeHash,
    parentHashes: input.parentHashes ?? [],
    message: input.message ?? "Initial commit",
    author: input.author ?? "Ada Lovelace",
    timestamp: input.timestamp ?? 1_700_000_000_000,
  };
  return { ...payload, hash: await hashObjectPayload(payload) };
}

function refsFor(
  mainCommit: Sha256Hash,
  extraBranches: Record<string, Sha256Hash> = {},
): RefState {
  return {
    head: { type: "branch", name: "main" },
    branches: { main: mainCommit, ...extraBranches },
  };
}

// ---------------------------------------------------------------------------
// Canonical serialization + SHA-256
// ---------------------------------------------------------------------------

describe("canonical serialization", () => {
  it("sorts object keys recursively but preserves array order", () => {
    const a = canonicalStringify({
      z: 1,
      a: { y: 2, b: [3, { d: 4, c: 5 }] },
    });
    const b = canonicalStringify({
      a: { b: [3, { c: 5, d: 4 }], y: 2 },
      z: 1,
    });

    expect(a).toBe(b);
    expect(a).toBe('{"a":{"b":[3,{"c":5,"d":4}],"y":2},"z":1}');
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]));
  });

  it("rejects values that are not in the JSON data model", () => {
    expect(() => canonicalStringify({ a: undefined })).toThrow(
      CanonicalSerializationError,
    );
    expect(() => canonicalStringify({ a: Number.NaN })).toThrow(
      CanonicalSerializationError,
    );
    expect(() => canonicalStringify({ a: Infinity })).toThrow(
      CanonicalSerializationError,
    );
    expect(() => canonicalStringify({ a: new Date() })).toThrow(
      CanonicalSerializationError,
    );
    expect(() => canonicalStringify({ a: 1n })).toThrow(
      CanonicalSerializationError,
    );

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalStringify(circular)).toThrow(
      /circular reference/i,
    );
  });
});

describe("sha256 hashing", () => {
  it("matches published SHA-256 test vectors", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes logically identical payloads identically", async () => {
    const blobA = await makeBlob("hello");
    const blobB = await makeBlob("world");

    const treePayloadA = {
      type: "tree" as const,
      entries: { "a.md": blobA.hash, "b.md": blobB.hash },
    };
    const treePayloadB = {
      type: "tree" as const,
      entries: { "b.md": blobB.hash, "a.md": blobA.hash },
    };

    expect(await hashObjectPayload(treePayloadA)).toBe(
      await hashObjectPayload(treePayloadB),
    );

    const commitA: HashableObjectPayload = {
      type: "commit",
      treeHash: blobA.hash,
      parentHashes: [],
      message: "canonical",
      author: "Ada",
      timestamp: 1,
    };
    const commitB: HashableObjectPayload = {
      timestamp: 1,
      author: "Ada",
      message: "canonical",
      parentHashes: [],
      treeHash: blobA.hash,
      type: "commit",
    };
    expect(await hashObjectPayload(commitA)).toBe(
      await hashObjectPayload(commitB),
    );
  });

  it("changes the address when content changes", async () => {
    const first = await makeBlob("hello");
    const second = await makeBlob("hellx");
    expect(first.hash).not.toBe(second.hash);
    expect(first.byteLength).toBe(second.byteLength);
  });

  it("measures blobs in UTF-8 bytes, not UTF-16 code units", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("café")).toBe(5);
    expect(utf8ByteLength("🧠")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Shared storage contract: InMemory and IndexedDB must behave identically
// ---------------------------------------------------------------------------

interface AdapterCase {
  name: string;
  create: () => IObjectStorage;
}

const adapterCases: AdapterCase[] = [
  {
    name: "InMemoryObjectStorage",
    create: () => new InMemoryObjectStorage(),
  },
  {
    name: "IndexedDBObjectStorage",
    create: () =>
      new IndexedDBObjectStorage({
        dbName: `chronicle-cas-test-${crypto.randomUUID()}`,
      }),
  },
];

for (const adapterCase of adapterCases) {
  describe(adapterCase.name, () => {
    let store: IObjectStorage;

    beforeEach(() => {
      store = adapterCase.create();
    });

    afterEach(async () => {
      await store.clear();
      await store.close();
    });

    it("stores blobs, trees, commits, and singleton refs", async () => {
      const blob = await makeBlob("# Hello\n");
      const tree = await makeTree({ "hello.md": blob.hash });
      const commit = await makeCommit({ treeHash: tree.hash });
      const refs = refsFor(commit.hash);

      await store.writeBatch({
        objects: [blob, tree, commit],
        refs,
      });

      expect(await store.getObject(blob.hash)).toEqual(blob);
      expect(await store.getObject(tree.hash)).toEqual(tree);
      expect(await store.getObject(commit.hash)).toEqual(commit);
      expect(await store.getObject("0".repeat(64))).toBeUndefined();
      expect(await store.hasObject(blob.hash)).toBe(true);
      expect(await store.getRefs()).toEqual(refs);
      expect(await store.listObjects()).toHaveLength(3);
    });

    it("deduplicates identical blobs across independent writes", async () => {
      const original = await makeBlob("shared content");
      const equivalent = await makeBlob("shared content");

      expect(equivalent.hash).toBe(original.hash);
      await store.putObject(original);
      await store.putObject(equivalent);
      // Same hash, but an independently constructed object value.
      await store.putObjects([{ ...equivalent }]);

      const objects = await store.listObjects();
      expect(objects).toHaveLength(1);
      expect(objects[0]).toEqual(original);

      const fetched = await store.getObjects([original.hash, "1".repeat(64)]);
      expect(fetched.size).toBe(1);
      expect(fetched.get(original.hash)).toEqual(original);
    });

    it("rejects tampered objects and writes nothing", async () => {
      const blob = await makeBlob("hello");
      const tampered: BlobObject = { ...blob, content: "hellx" };

      await expect(store.putObject(tampered)).rejects.toBeInstanceOf(
        ObjectIntegrityError,
      );
      expect(await store.hasObject(blob.hash)).toBe(false);
      expect(await store.listObjects()).toHaveLength(0);

      await store.putObject(blob);
      await expect(store.putObject(tampered)).rejects.toBeInstanceOf(
        ObjectIntegrityError,
      );
      expect(await store.getObject(blob.hash)).toEqual(blob);
    });

    it("rejects a batch whose duplicate address has different content", async () => {
      const first = await makeBlob("one");
      const impostor: BlobObject = { ...(await makeBlob("two")), hash: first.hash };

      await expect(
        store.writeBatch({ objects: [first, impostor] }),
      ).rejects.toBeInstanceOf(ObjectIntegrityError);
      expect(await store.listObjects()).toHaveLength(0);
    });

    it("validates refs before any object becomes visible", async () => {
      const blob = await makeBlob("atomic");
      const tree = await makeTree({ "atomic.md": blob.hash });
      const commit = await makeCommit({ treeHash: tree.hash });

      const badRefs: RefState = {
        head: { type: "branch", name: "main" },
        branches: { trunk: commit.hash },
      };

      await expect(
        store.writeBatch({ objects: [blob, tree, commit], refs: badRefs }),
      ).rejects.toBeInstanceOf(InvalidRefStateError);

      expect(await store.listObjects()).toHaveLength(0);
      expect(await store.getRefs()).toBeNull();

      const badHashRefs: RefState = {
        head: { type: "branch", name: "main" },
        branches: { main: "not-a-hash" },
      };
      await expect(store.writeBatch({ refs: badHashRefs })).rejects.toBeInstanceOf(
        InvalidRefStateError,
      );
    });

    it("serializes concurrent ref updates without losing branches", async () => {
      const blob = await makeBlob("refs");
      const tree = await makeTree({ "refs.md": blob.hash });
      const commit = await makeCommit({ treeHash: tree.hash });

      await store.writeBatch({
        objects: [blob, tree, commit],
        refs: refsFor(commit.hash),
      });

      const branchNames = Array.from(
        { length: 20 },
        (_, index) => `feat/branch-${index}`,
      );

      await Promise.all(
        branchNames.map((name) =>
          store.updateRefs((current) => {
            if (!current) throw new Error("expected refs");
            return {
              ...current,
              branches: { ...current.branches, [name]: commit.hash },
            };
          }),
        ),
      );

      const refs = await store.getRefs();
      expect(refs).not.toBeNull();
      expect(Object.keys(refs?.branches ?? {})).toHaveLength(21);
      for (const name of branchNames) {
        expect(refs?.branches[name]).toBe(commit.hash);
      }
    });

    it("keeps a single latest RefState and supports detached HEAD", async () => {
      const blob = await makeBlob("detached");
      const tree = await makeTree({ "detached.md": blob.hash });
      const firstCommit = await makeCommit({ treeHash: tree.hash });
      const secondCommit = await makeCommit({
        treeHash: tree.hash,
        parentHashes: [firstCommit.hash],
        message: "second",
      });

      await store.writeBatch({
        objects: [blob, tree, firstCommit, secondCommit],
        refs: refsFor(firstCommit.hash),
      });

      const detached: RefState = {
        head: { type: "detached", commitHash: secondCommit.hash },
        branches: { main: secondCommit.hash },
      };
      await store.writeBatch({ refs: detached });

      expect(await store.getRefs()).toEqual(detached);
    });

    it("clears objects and refs", async () => {
      const blob = await makeBlob("temporary");
      const tree = await makeTree({ "temp.md": blob.hash });
      const commit = await makeCommit({ treeHash: tree.hash });
      await store.writeBatch({
        objects: [blob, tree, commit],
        refs: refsFor(commit.hash),
      });

      await store.clear();

      expect(await store.listObjects()).toHaveLength(0);
      expect(await store.getRefs()).toBeNull();
    });
  });
}

// ---------------------------------------------------------------------------
// IndexedDB-specific durability
// ---------------------------------------------------------------------------

describe("IndexedDB durability", () => {
  it("reopens a database and preserves immutable objects and refs", async () => {
    const dbName = `chronicle-cas-durability-${crypto.randomUUID()}`;
    const blob = await makeBlob("durable");
    const tree = await makeTree({ "durable.md": blob.hash });
    const commit = await makeCommit({ treeHash: tree.hash });
    const refs = refsFor(commit.hash);

    const first = new IndexedDBObjectStorage({ dbName });
    await first.writeBatch({ objects: [blob, tree, commit], refs });
    await first.close();

    const second = new IndexedDBObjectStorage({ dbName });
    expect(await second.getRefs()).toEqual(refs);
    expect(await second.listObjects()).toHaveLength(3);
    expect(await second.getObject(blob.hash)).toEqual(blob);
    await second.clear();
    await second.close();
  });

  it("does not duplicate an existing object when the same payload is re-added", async () => {
    const dbName = `chronicle-cas-idempotent-${crypto.randomUUID()}`;
    const store = new IndexedDBObjectStorage({ dbName });
    const blob = await makeBlob("idempotent");

    await store.writeBatch({ objects: [blob] });
    await store.writeBatch({ objects: [blob] });

    expect(await store.listObjects()).toHaveLength(1);
    await store.clear();
    await store.close();
  });
});

// ---------------------------------------------------------------------------
// Telemetry: logical vs deduplicated bytes
// ---------------------------------------------------------------------------

describe("storage telemetry", () => {
  it("reports zeroed metrics for an empty store", () => {
    expect(computeStorageTelemetry([])).toEqual({
      blobCount: 0,
      treeCount: 0,
      commitCount: 0,
      logicalBytes: 0,
      deduplicatedBytes: 0,
      deduplicationRatio: 0,
      lastWriteLatencyMs: 0,
    });
  });

  it("counts every commit snapshot as logical bytes but stores each blob once", async () => {
    const readme = await makeBlob("alpha\n"); // 6 bytes
    const design = await makeBlob("beta\n"); // 5 bytes

    const tree1 = await makeTree({ "notes/a.md": readme.hash });
    const commit1 = await makeCommit({ treeHash: tree1.hash });

    const tree2 = await makeTree({
      "notes/a.md": readme.hash,
      "notes/b.md": design.hash,
    });
    const commit2 = await makeCommit({
      treeHash: tree2.hash,
      parentHashes: [commit1.hash],
      message: "Add design notes",
    });

    const store = new InMemoryObjectStorage();
    await store.writeBatch({
      objects: [readme, design, tree1, tree2, commit1, commit2],
      refs: refsFor(commit2.hash),
    });

    const telemetry = computeStorageTelemetry(await store.listObjects(), 3.5);

    expect(telemetry.blobCount).toBe(2);
    expect(telemetry.treeCount).toBe(2);
    expect(telemetry.commitCount).toBe(2);
    expect(telemetry.logicalBytes).toBe(6 + 11);
    expect(telemetry.deduplicatedBytes).toBe(11);
    expect(telemetry.deduplicationRatio).toBeCloseTo(1 - 11 / 17, 10);
    expect(telemetry.lastWriteLatencyMs).toBe(3.5);
  });
});
