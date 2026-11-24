/**
 * First-visit demo repository.
 *
 * Creates a realistic five-commit, two-branch engineering workspace:
 *
 *   main:      root ── protocol ── origin-guards ── quota-limits (HEAD)
 *                         └─ feat/sync-protocol ── split-brain-recovery
 *
 * `docs/architecture.md` is edited on both sides of the divergence, so
 * merging `feat/sync-protocol` into `main` immediately exercises the LCA-based
 * three-way merge and produces one intentional conflict.
 */

import type { IWorkingTree } from "../vcs/Repository";
import { Repository } from "../vcs/Repository";
import type { IObjectStorage } from "../cas/ObjectStore";
import type { CommitObject, RefState } from "../types";

export const DEMO_MAIN_BRANCH = "main";
export const DEMO_FEATURE_BRANCH = "feat/sync-protocol";
export const DEMO_CONFLICT_PATH = "docs/architecture.md";

const ROOT_FILES: Record<string, string> = {
  "README.md": `# Helios Engineering Notes

A local-first engineering workspace for the Helios platform. Every keystroke
converges across tabs, and every commit is content-addressed.

## Start here
- \`docs/architecture.md\` — system design and sync transport
- \`docs/roadmap.md\` — delivery plan
`,
  "docs/architecture.md": `# Helios Architecture

## Overview

Helios is a local-first workspace. Documents live in IndexedDB, converge
across tabs through a CRDT, and never require a backend.

## Sync transport

Tabs exchange updates through a BroadcastChannel relay.

## Storage

Commits are immutable and addressed by SHA-256 over canonical JSON.
`,
  "docs/roadmap.md": `# Roadmap

- [x] Content-addressable object store
- [x] LCA-based three-way merge
- [ ] Protocol hardening
- [ ] Storage quota telemetry
`,
};

const PROTOCOL_FILES: Record<string, string> = {
  ...ROOT_FILES,
  "docs/architecture.md": `# Helios Architecture

## Overview

Helios is a local-first workspace. Documents live in IndexedDB, converge
across tabs through a CRDT, and never require a backend.

## Sync transport

Tabs exchange binary updates through \`BroadcastChannel("chronicle-crdt-sync")\`.
A startup state-vector handshake catches up a tab that opens mid-session.

## Storage

Commits are immutable and addressed by SHA-256 over canonical JSON.
`,
  "docs/sync-protocol.md": `# Sync Protocol

## Handshake

**SYNC_STEP_1** sends a Yjs state vector.
**SYNC_STEP_2** replies with the missing update for that vector.

## Update relay

Local edits are encoded with \`Y.encodeStateAsUpdate\` and posted to every tab.
`,
  "docs/roadmap.md": `# Roadmap

- [x] Content-addressable object store
- [x] LCA-based three-way merge
- [~] Protocol hardening
- [ ] Storage quota telemetry
`,
};

const MAIN_GUARDS_FILES: Record<string, string> = {
  ...PROTOCOL_FILES,
  "docs/architecture.md": `# Helios Architecture

## Overview

Helios is a local-first workspace. Documents live in IndexedDB, converge
across tabs through a CRDT, and never require a backend.

## Sync transport

Tabs exchange binary updates through \`BroadcastChannel("chronicle-crdt-sync")\`.
Updates applied from the relay use the \`broadcast\` origin and are never echoed.
A startup state-vector handshake catches up a tab that opens mid-session.

## Storage

Commits are immutable and addressed by SHA-256 over canonical JSON.
`,
};

const MAIN_LIMITS_FILES: Record<string, string> = {
  ...MAIN_GUARDS_FILES,
  "docs/architecture.md": `# Helios Architecture

## Overview

Helios is a local-first workspace. Documents live in IndexedDB, converge
across tabs through a CRDT, and never require a backend.

## Sync transport

Tabs exchange binary updates through \`BroadcastChannel("chronicle-crdt-sync")\`.
Updates applied from the relay use the \`broadcast\` origin and are never echoed.
A startup state-vector handshake catches up a tab that opens mid-session.

## Storage

Commits are immutable and addressed by SHA-256 over canonical JSON.

## Durability limits

IndexedDB can evict origin data under storage pressure. The X-Ray drawer
surfaces \`navigator.storage.estimate()\` so the workspace can warn early.
`,
  "docs/roadmap.md": `# Roadmap

- [x] Content-addressable object store
- [x] LCA-based three-way merge
- [x] Protocol hardening
- [x] Storage quota telemetry
- [ ] Split-brain recovery drill
`,
};

const FEATURE_FILES: Record<string, string> = {
  ...PROTOCOL_FILES,
  "docs/architecture.md": `# Helios Architecture

## Overview

Helios is a local-first workspace. Documents live in IndexedDB, converge
across tabs through a CRDT, and never require a backend.

## Sync transport

Tabs exchange binary updates through \`BroadcastChannel("chronicle-crdt-sync")\`.
Updates from \`IndexeddbPersistence\` and remote tabs are filtered by the relay guard.
A startup state-vector handshake catches up a tab that opens mid-session.

## Storage

Commits are immutable and addressed by SHA-256 over canonical JSON.
`,
  "docs/sync-protocol.md": `# Sync Protocol

## Handshake

**SYNC_STEP_1** sends a Yjs state vector.
**SYNC_STEP_2** replies with the missing update for that vector.

## Update relay

Local edits are encoded with \`Y.encodeStateAsUpdate\` and posted to every tab.
Remote updates are applied with the \`broadcast\` origin.

## Split-brain recovery

If two tabs diverge after a channel disconnect, both exchange state vectors on
reconnect. Yjs merges the missing updates without a server-side arbiter.
`,
  "docs/recovery.md": `# Recovery Notes

1. Reopen the BroadcastChannel.
2. Send **SYNC_STEP_1** with the local state vector.
3. Apply **SYNC_STEP_2** with the \`broadcast\` origin.
`,
};

export interface DemoCommits {
  root: CommitObject;
  protocol: CommitObject;
  mainOriginGuards: CommitObject;
  mainQuotaLimits: CommitObject;
  featureRecovery: CommitObject;
}

export interface SeedDemoRepoOptions {
  storage: IObjectStorage;
  workingTree: IWorkingTree;
  author?: string;
  /** Injectable clock for deterministic commit hashes in tests. */
  now?: () => number;
  /** Clear every object and ref before seeding (Reset Demo Workspace). */
  force?: boolean;
}

export interface SeedDemoRepoResult {
  /** False when a repository already existed and `force` was not set. */
  seeded: boolean;
  refs: RefState;
  commits: DemoCommits | null;
}

const DEMO_AUTHOR = "Helios Demo";
const BASE_TIMESTAMP = Date.UTC(2026, 1, 9, 9, 0, 0);

function createClock(): () => number {
  let tick = 0;
  return () => BASE_TIMESTAMP + tick++ * 60_000;
}

/**
 * Seeds the demo repository only when no RefState exists, or when `force` is
 * true. The final state leaves HEAD on `main`, with `feat/sync-protocol`
 * diverged at the protocol commit so the merge flow works on first load.
 */
export async function seedDemoRepo(
  options: SeedDemoRepoOptions,
): Promise<SeedDemoRepoResult> {
  const { storage, workingTree } = options;

  if (!options.force) {
    const existing = await storage.getRefs();
    if (existing) {
      return { seeded: false, refs: existing, commits: null };
    }
  } else {
    await storage.clear();
    await workingTree.hydrateFromTree({});
  }

  const now = options.now ?? createClock();
  const repo = new Repository({
    storage,
    workingTree,
    author: options.author ?? DEMO_AUTHOR,
    defaultBranch: DEMO_MAIN_BRANCH,
    now,
  });

  await repo.init();

  await workingTree.hydrateFromTree(ROOT_FILES);
  const root = await repo.commit({
    message: "chore: initialize Helios engineering notes",
  });

  await workingTree.hydrateFromTree(PROTOCOL_FILES);
  const protocol = await repo.commit({
    message: "docs: describe the CRDT sync protocol",
  });

  await repo.createBranch(DEMO_FEATURE_BRANCH);

  await workingTree.hydrateFromTree(MAIN_GUARDS_FILES);
  const mainOriginGuards = await repo.commit({
    message: "docs: document relay origin guards",
  });

  await workingTree.hydrateFromTree(MAIN_LIMITS_FILES);
  const mainQuotaLimits = await repo.commit({
    message: "docs: add quota and tombstone failure modes",
  });

  await repo.checkout(DEMO_FEATURE_BRANCH);
  await workingTree.hydrateFromTree(FEATURE_FILES);
  const featureRecovery = await repo.commit({
    message: "feat: draft split-brain recovery",
  });

  await repo.checkout(DEMO_MAIN_BRANCH);

  const refs = await storage.getRefs();
  if (!refs) {
    throw new Error("Demo seeding completed without a RefState");
  }

  return {
    seeded: true,
    refs,
    commits: {
      root,
      protocol,
      mainOriginGuards,
      mainQuotaLimits,
      featureRecovery,
    },
  };
}
