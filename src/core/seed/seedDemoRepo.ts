import type { IObjectStorage } from '../cas/ObjectStore';
import { Repository } from '../vcs/Repository';

const SEED_META_KEY = 'chronicle_demo_seeded_v1';

const BASE_README = `# Chronicle Workspace

Chronicle is a zero-login, local-first knowledge workspace pairing an immutable SHA-256 Merkle-DAG with a live Yjs CRDT working tree.

## Core Guarantees

- **Zero Login & Offline Autonomy**: All objects, branches, and search indexes persist locally in IndexedDB with full offline PWA support.
- **Content-Addressable Storage**: Blobs, trees, and commits are hashed canonically via Web Crypto SHA-256.
- **Multi-Tab CRDT Editing**: Open a twin tab to collaborate in real time over BroadcastChannel with per-file undo isolation.
- **Deterministic 3-Way Merge**: Bidirectional BFS LCA resolution with interactive conflict markers.
- **Full-Text Inverted Index Search**: Press \`⌘⇧F\` (or \`Ctrl+Shift+F\`) to search across every historical commit blob and live working-tree draft.
- **Multi-Workspace & Portable Backups**: Switch between isolated notebooks, share sanitized snapshots via URL, or export/import full \`.zip\` & \`.json\` archives.

## Quick Walkthrough

1. Edit any Markdown document and observe the live Myers diff.
2. Commit your changes to append a new immutable node to the Merkle-DAG.
3. Merge \`feat/sync-protocol\` into \`main\` to test a real 3-way conflict on \`docs/architecture.md\`.
4. Press \`⌘⇧F\` to search historical commits and live drafts via the IndexedDB inverted index.
5. Open **X-Ray** to inspect live CAS deduplication metrics and the interactive commit DAG.
`;

const ROOT_ARCHITECTURE = `# System Architecture

## Storage Engine

Chronicle stores immutable \`blob\`, \`tree\`, and \`commit\` objects inside IndexedDB using write-once semantics.

## Sync Transport

- Transport: Single-tab IndexedDB persistence
- Handshake: Pending protocol specification
- Conflict Policy: Last-writer-wins fallback

## Working Tree Boundary

The React interface interacts exclusively with a Zustand store backed by pure TypeScript primitives in \`src/core/\`.
`;

const PROTOCOL_ARCHITECTURE = `# System Architecture

## Storage Engine

Chronicle stores immutable \`blob\`, \`tree\`, and \`commit\` objects inside IndexedDB using write-once semantics.
All payloads pass through canonical JSON key-sorting prior to SHA-256 hashing.

## Sync Transport

- Transport: BroadcastChannel (\`chronicle-crdt-sync\`)
- Handshake: SYNC_STEP_1 state vector exchange
- Conflict Policy: Character-level CRDT convergence

## Working Tree Boundary

The React interface interacts exclusively with a Zustand store backed by pure TypeScript primitives in \`src/core/\`.
`;

const MAIN_ORIGIN_GUARDS_ARCHITECTURE = `# System Architecture

## Storage Engine

Chronicle stores immutable \`blob\`, \`tree\`, and \`commit\` objects inside IndexedDB using write-once semantics.
All payloads pass through canonical JSON key-sorting prior to SHA-256 hashing.

## Sync Transport

- Transport: BroadcastChannel (\`chronicle-crdt-sync\`) with origin guards
- Handshake: SYNC_STEP_1 -> SYNC_STEP_2 state vector delta
- Conflict Policy: Origin-isolated undo stack (ignores \`broadcast\` and \`checkout\`)

## Working Tree Boundary

The React interface interacts exclusively with a Zustand store backed by pure TypeScript primitives in \`src/core/\`.
`;

const FEAT_SPLIT_BRAIN_ARCHITECTURE = `# System Architecture

## Storage Engine

Chronicle stores immutable \`blob\`, \`tree\`, and \`commit\` objects inside IndexedDB using write-once semantics.
All payloads pass through canonical JSON key-sorting prior to SHA-256 hashing.

## Sync Transport

- Transport: BroadcastChannel + pluggable \`ISyncTransport\` relay
- Handshake: Bidirectional SYNC_STEP_1 / SYNC_STEP_2 with epoch fencing
- Conflict Policy: Automatic split-brain convergence on reconnect

## Working Tree Boundary

The React interface interacts exclusively with a Zustand store backed by pure TypeScript primitives in \`src/core/\`.
`;

const CRDT_PROTOCOL_SPEC = `# CRDT Working Tree Protocol

## Overview

Each file in the active workspace is modeled as a \`Y.Text\` instance stored inside a shared \`Y.Map('files')\`.

## Transaction Origins

| Origin | Purpose | Recorded in UndoManager |
| :--- | :--- | :--- |
| \`local\` | Direct user keystrokes in CodeMirror | Yes |
| \`checkout\` | Atomic tree hydration on branch switch | No (clears stack) |
| \`broadcast\` | Remote tab updates via BroadcastChannel | No |
| \`persistence\` | Initial hydration from \`y-indexeddb\` | No |
`;

const UNDO_MODEL_SPEC = `# Per-File Undo Isolation

Each \`Y.Text\` maintains its own \`Y.UndoManager\` configured with \`trackedOrigins: new Set(['local'])\`.

1. Remote edits from sibling browser tabs never enter the local user's undo history.
2. Checking out another branch runs inside a single \`checkout\` transaction and purges stale undo frames.
`;

const STORAGE_QUOTA_DOC = `# IndexedDB Quota & Telemetry

Browser storage engines enforce origin-level quotas via \`navigator.storage.estimate()\`.

- **Logical Bytes**: Sum of file sizes across every historical commit snapshot.
- **Deduplicated Bytes**: Physical byte footprint of unique SHA-256 blobs retained in CAS.
- **Deduplication Ratio**: \`logicalBytes / deduplicatedBytes\`.
`;

const SPLIT_BRAIN_SPEC = `# Split-Brain Recovery Protocol

When two browser tabs operate offline or across suspended background timers, their Yjs state vectors diverge.

## Reconnect Sequence

1. Reconnecting tab broadcasts \`SYNC_STEP_1\` carrying \`Y.encodeStateVector(doc)\`.
2. Active peers reply with \`SYNC_STEP_2\` containing only missing updates.
3. Both documents converge identically without user intervention.
`;

export interface SeedOptions {
  force?: boolean;
}

/**
 * Seeds the 5-commit, 2-branch demonstration repository:
 *
 * main:      root ── protocol ── origin-guards ── quota-limits (HEAD)
 *                    └─ feat/sync-protocol ── split-brain-recovery
 *
 * Merging feat/sync-protocol into main produces a clean deterministic conflict
 * in docs/architecture.md (Sync Transport section) while cleanly adding specs/split-brain.md.
 */
export async function seedDemoRepo(
  storage: IObjectStorage,
  options: SeedOptions = {}
): Promise<boolean> {
  if (!options.force) {
    const alreadySeeded = await storage.getMeta<boolean>(SEED_META_KEY);
    const initialized = await storage.getRefs();
    if (alreadySeeded && initialized) {
      return false;
    }
  } else {
    await storage.clear();
  }

  const repo = new Repository(storage);
  const baseTime = 1763900000000;

  // 1. root
  const rootFiles: Record<string, string> = {
    'README.md': BASE_README,
    'docs/architecture.md': ROOT_ARCHITECTURE,
  };
  await repo.init(
    rootFiles,
    'Harsh Diwan',
    'chore: initialize chronicle workspace',
    baseTime
  );

  // 2. protocol
  const protocolFiles: Record<string, string> = {
    ...rootFiles,
    'docs/architecture.md': PROTOCOL_ARCHITECTURE,
    'specs/crdt-protocol.md': CRDT_PROTOCOL_SPEC,
  };
  const protocolCommit = await repo.commit(
    protocolFiles,
    'feat: define CAS canonical serialization and sync protocol',
    'Harsh Diwan',
    undefined,
    baseTime + 60_000 * 15
  );

  // Create feature branch at `protocol`
  await repo.createBranch('feat/sync-protocol', protocolCommit.hash);

  // 3. origin-guards on main
  const originGuardsFiles: Record<string, string> = {
    ...protocolFiles,
    'docs/architecture.md': MAIN_ORIGIN_GUARDS_ARCHITECTURE,
    'specs/undo-model.md': UNDO_MODEL_SPEC,
  };
  await repo.commit(
    originGuardsFiles,
    'feat: enforce Yjs transaction origin guards and undo isolation',
    'Harsh Diwan',
    undefined,
    baseTime + 60_000 * 42
  );

  // 4. quota-limits on main
  const quotaLimitsFiles: Record<string, string> = {
    ...originGuardsFiles,
    'docs/storage-quota.md': STORAGE_QUOTA_DOC,
  };
  await repo.commit(
    quotaLimitsFiles,
    'docs: document IndexedDB quota limits and CAS deduplication telemetry',
    'Harsh Diwan',
    undefined,
    baseTime + 60_000 * 75
  );

  // 5. Switch to feat/sync-protocol, create split-brain-recovery, then switch back to main
  const featCheckout = await repo.checkout('feat/sync-protocol', quotaLimitsFiles);
  const featFiles: Record<string, string> = {
    ...featCheckout.files,
    'docs/architecture.md': FEAT_SPLIT_BRAIN_ARCHITECTURE,
    'specs/split-brain.md': SPLIT_BRAIN_SPEC,
  };
  await repo.commit(
    featFiles,
    'feat: add BroadcastChannel split-brain recovery and epoch fencing',
    'Harsh Diwan',
    undefined,
    baseTime + 60_000 * 90
  );

  // Switch HEAD back to main cleanly
  await repo.checkout('main', featFiles);
  await storage.setMeta(SEED_META_KEY, true);
  return true;
}

/**
 * Seeds a clean blank workspace with an initial Welcome.md commit on `main`.
 */
export async function seedBlankWorkspace(
  storage: IObjectStorage,
  workspaceName: string,
  author = 'Chronicle Author'
): Promise<boolean> {
  const initialized = await storage.getRefs();
  if (initialized) {
    return false;
  }

  const repo = new Repository(storage);
  const title = workspaceName.trim() || 'Untitled Workspace';
  await repo.init(
    {
      'Welcome.md': `# ${title}\n\nYour local-first, versioned Markdown workspace is ready.\n\n- Every edit saves automatically to IndexedDB.\n- Commit snapshots anytime to preserve immutable history in the Merkle-DAG.\n- Create branches to draft ideas safely and merge them back cleanly.\n`,
    },
    author,
    `chore: initialize ${title}`
  );
  await storage.setMeta(SEED_META_KEY, true);
  return true;
}
