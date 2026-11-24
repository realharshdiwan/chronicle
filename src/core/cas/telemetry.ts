/**
 * Storage telemetry for the X-Ray drawer.
 *
 * Distinguishes logical bytes (every file version across every commit) from
 * deduplicated physical bytes (unique blob contents actually stored), exposing
 * the savings created by content addressing.
 */

import type { Sha256Hash, StorageTelemetry, StoredObject } from "../types";

/**
 * Computes a snapshot from the complete set of stored objects.
 *
 * - `logicalBytes` counts every file in every commit snapshot.
 * - `deduplicatedBytes` sums unique blob payloads (objects are address-unique).
 * - Missing references are skipped defensively so telemetry never breaks the UI.
 */
export function computeStorageTelemetry(
  objects: readonly StoredObject[],
  lastWriteLatencyMs = 0,
): StorageTelemetry {
  const byHash = new Map<Sha256Hash, StoredObject>();
  for (const object of objects) {
    if (!byHash.has(object.hash)) byHash.set(object.hash, object);
  }

  let blobCount = 0;
  let treeCount = 0;
  let commitCount = 0;
  let logicalBytes = 0;
  let deduplicatedBytes = 0;

  for (const object of byHash.values()) {
    switch (object.type) {
      case "blob":
        blobCount += 1;
        deduplicatedBytes += object.byteLength;
        break;
      case "tree":
        treeCount += 1;
        break;
      case "commit":
        commitCount += 1;
        break;
    }
  }

  for (const object of byHash.values()) {
    if (object.type !== "commit") continue;

    const tree = byHash.get(object.treeHash);
    if (!tree || tree.type !== "tree") continue;

    for (const blobHash of Object.values(tree.entries)) {
      const blob = byHash.get(blobHash);
      if (blob?.type === "blob") {
        logicalBytes += blob.byteLength;
      }
    }
  }

  const deduplicationRatio =
    logicalBytes === 0 ? 0 : 1 - deduplicatedBytes / logicalBytes;

  return {
    blobCount,
    treeCount,
    commitCount,
    logicalBytes,
    deduplicatedBytes,
    deduplicationRatio,
    lastWriteLatencyMs,
  };
}
