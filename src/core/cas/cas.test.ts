import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalStringify,
  createBlobObject,
  createCommitObject,
  createTreeObject,
} from './hash';
import { InMemoryObjectStorage } from './ObjectStore';
import { computeStorageTelemetry } from './telemetry';

test('canonicalStringify sorts object keys deterministically', () => {
  const a = { z: 1, a: { d: 4, b: 2 }, m: [3, 1, 2] };
  const b = { m: [3, 1, 2], a: { b: 2, d: 4 }, z: 1 };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
  assert.equal(
    canonicalStringify(a),
    '{"a":{"b":2,"d":4},"m":[3,1,2],"z":1}'
  );
});

test('createBlobObject produces identical SHA-256 hash and accurate UTF-8 byteLength', async () => {
  const b1 = await createBlobObject('hello chronicle 🚀');
  const b2 = await createBlobObject('hello chronicle 🚀');
  assert.equal(b1.hash, b2.hash);
  assert.equal(b1.hash.length, 64);
  assert.equal(b1.byteLength, new TextEncoder().encode('hello chronicle 🚀').byteLength);
});

test('createTreeObject produces identical hash regardless of entry insertion order', async () => {
  const t1 = await createTreeObject({ 'b.md': 'hashB', 'a.md': 'hashA' });
  const t2 = await createTreeObject({ 'a.md': 'hashA', 'b.md': 'hashB' });
  assert.equal(t1.hash, t2.hash);
});

test('InMemoryObjectStorage enforces write-once immutability and deduplicated telemetry', async () => {
  const storage = new InMemoryObjectStorage();
  const blobA = await createBlobObject('repeated content block');
  const blobB = await createBlobObject('unique content');

  const tree1 = await createTreeObject({ 'a.md': blobA.hash, 'b.md': blobB.hash });
  const commit1 = await createCommitObject({
    treeHash: tree1.hash,
    parentHashes: [],
    message: 'first',
    author: 'tester',
    timestamp: 1000,
  });

  // Second commit reuses blobA unchanged
  const blobC = await createBlobObject('updated unique');
  const tree2 = await createTreeObject({ 'a.md': blobA.hash, 'b.md': blobC.hash });
  const commit2 = await createCommitObject({
    treeHash: tree2.hash,
    parentHashes: [commit1.hash],
    message: 'second',
    author: 'tester',
    timestamp: 2000,
  });

  await storage.writeBatch([blobA, blobB, tree1, commit1]);
  // Attempt to overwrite blobA with tampered content under same hash -> must be ignored
  await storage.putObject({ ...blobA, content: 'TAMPERED' });
  const fetched = await storage.getObject(blobA.hash);
  assert.equal(fetched?.type === 'blob' && fetched.content, 'repeated content block');

  await storage.writeBatch([blobA, blobC, tree2, commit2]);
  const telemetry = await computeStorageTelemetry(storage, 1.5, [1.5]);

  assert.equal(telemetry.blobCount, 3);
  assert.equal(telemetry.treeCount, 2);
  assert.equal(telemetry.commitCount, 2);
  // Logical bytes = 2 * blobA + blobB + blobC; deduplicated = blobA + blobB + blobC
  assert.equal(
    telemetry.logicalBytes,
    blobA.byteLength * 2 + blobB.byteLength + blobC.byteLength
  );
  assert.equal(
    telemetry.deduplicatedBytes,
    blobA.byteLength + blobB.byteLength + blobC.byteLength
  );
  assert.ok(telemetry.deduplicationRatio > 1);
});
