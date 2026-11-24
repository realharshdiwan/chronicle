# Chronicle

A zero-login, local-first, Git-style knowledge workspace. Two distributed-systems
primitives run entirely in the browser:

- **Live working tree:** Yjs + `y-indexeddb` + `BroadcastChannel` for instant
  multi-tab editing with no server.
- **Immutable history:** a SHA-256 content-addressable Merkle-DAG in IndexedDB
  implementing Git semantics (blobs, trees, commits, branches, checkout, diff,
  LCA-based three-way merge).

The full architecture specification lives in
[`local_first_git_style_workspace_architecture.md`](./local_first_git_style_workspace_architecture.md).

## Status

| Phase | Scope | Status |
| :--- | :--- | :--- |
| **1** | Scaffold + content-addressable object store (`src/core/cas`) | **Complete** |
| **2** | VCS engine, bidirectional BFS LCA, 3-way merge (`src/core/vcs`, `src/core/merge`) | **Complete** |
| **3** | CRDT working tree + cross-tab sync bridge (`src/core/crdt`) | **Complete** |
| **4** | Seeded demo repo + workspace UI | **Complete** |
| **5** | X-Ray drawer + benchmarks + architecture README | **Complete** |

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 (or the port Vite prints). The first load seeds a
5-commit, 2-branch demo repository (`main` and `feat/sync-protocol`) with an
intentional conflict in `docs/architecture.md` so you can immediately exercise
the LCA three-way merge.

### Key Actions

| Shortcut / Button | Action |
| :--- | :--- |
| ⌘K | Command palette (all actions) |
| ⌘S (in editor) | Commit with message from header |
| Branch selector | Checkout branches |
| Merge feature | LCA three-way merge of `feat/sync-protocol` |
| Reset demo workspace | Clear IndexedDB and reseed the fixture |
| Toggle Internals X-Ray | CAS metrics, DAG graph, storage estimate |
| Open synced twin tab | Verify cross-tab convergence |

## Verification Gates

```bash
npm run typecheck         # zero TypeScript errors
npm test                  # 76 tests across all phases
npm run bench             # three benchmarks with numbers below
npm run build             # production bundle succeeds
```

## Architecture

```mermaid
flowchart TB
    subgraph UI["Workspace UI (React + CodeMirror 6)"]
        Editor[MarkdownEditor\nCodeMirror ↔ Y.Text]
        Diff[DiffViewer\nUnified diff + conflict resolution]
        Sidebar[SidebarTree\nFile list + status badges]
        Top[TopBar\nBranch, commit, merge, reset, X-Ray]
        Palette[CommandPalette\n⌘K actions]
        XRay[XRayDrawer\nCAS metrics + DAG + twin tab]
    end

    subgraph State["Zustand Store (src/state/workspace.ts)"]
        Store[WorkspaceState\nrefs, branches, diffs, files,\nactivePath, pendingMerge,\ntelemetry, latencySamples,\nstorageEstimate]
        Actions[Actions\ninitialize, refresh, commit,\ncheckout, merge, resetDemo,\ninspectCommit, openTwinTab]
    end

    subgraph Core["src/core/ — pure TypeScript, no React"]
        Repo[Repository\ninit, status, commit, branch,\ncheckout, merge, reset]
        CAS[IndexedDBObjectStorage\nIObjectStorage adapter]
        Hash[canonicalStringify + SHA-256\nContent-addressable hashing]
        DAG[findLCA + getCommitHistory\nBidirectional BFS LCA]
        DiffCore[diffFileMaps + diffTrees\nMyers line diff]
        Merge[threeWayMerge + conflictParser\nLine-level diff3 + markers]
        Tree[WorkingTreeDoc\nY.Map<Y.Text> + y-indexeddb]
        Bridge[TabSyncBridge\nBroadcastChannel relay]
        Undo[FileUndoManager\nPer-file Y.UndoManager]
        Seed[seedDemoRepo\n5 commits, 2 branches]
    end

    Editor -->|Y.Text| Tree
    Editor -->|keymap| Undo
    Tree -.->|ydoc.transact("checkout")| Bridge
    Bridge -.->|BroadcastChannel| Tree
    Tree -.->|y-indexeddb| CAS
    Actions --> Repo
    Repo --> CAS
    Repo --> Tree
    Repo --> DAG
    Repo --> Merge
    Merge --> DiffCore
    Seed --> Repo
    Store --> Actions
    Store --> CAS
    Store --> Tree
    Store --> Bridge
    Actions --> CAS
    Actions --> Tree
    Actions --> Bridge
    XRay --> CAS
    XRay --> DAG
    XRay --> Repo
```

### Data Flow (Simplified)

```
User keystroke
    │
    ▼
CodeMirror (local) ──► Y.Text (LOCAL_EDIT_ORIGIN)
    │                       │
    │                       ▼
    │               FileUndoManager (tracks only "local")
    │                       │
    ▼                       ▼
WorkingTreeDoc.setFile()  ◄──┘
    │
    ▼
TabSyncBridge ◄─── Y.encodeStateAsUpdate()
    │
    ├──► BroadcastChannel("chronicle-crdt-sync") ──► Other tabs
    │
    └──► y-indexeddb ◄─── IndexedDBObjectStorage ◄─── Repository.commit()
                                                  │
                                                  ▼
                                           Merkle-DAG (blobs, trees, commits)
```

## Core Modules

```
src/core/
├── types.ts                 Blob, Tree, Commit, RefState, Diff, Merge, Telemetry
├── cas/
│   ├── hash.ts              canonical sorted-key JSON + Web Crypto SHA-256
│   ├── ObjectStore.ts       IObjectStorage, InMemory + IndexedDB adapters
│   └── telemetry.ts         logical vs deduplicated byte accounting
├── vcs/
│   ├── dag.ts               iterative topological traversal + bidirectional BFS LCA
│   ├── diff.ts              Myers line diff + tree/working-tree change classification
│   ├── Repository.ts        init, status, commit, branch, checkout, merge, reset
│   └── errors.ts            typed Git-semantics errors
├── merge/
│   ├── threeWayMerge.ts     clean file/line merges + conservative conflict regions
│   └── conflictParser.ts    generate, parse, and resolve Git-style markers
├── crdt/
│   ├── WorkingTreeDoc.ts    Y.Map<Y.Text> working tree + y-indexeddb + atomic hydration
│   ├── TabSyncBridge.ts     BroadcastChannel relay, update-origin guards, state-vector handshake
│   └── undo.ts              FileUndoManager (per-file, local-origin only)
└── seed/
    └── seedDemoRepo.ts      5 commits, 2 branches, intentional conflict, force reset

tests/
├── cas.test.ts              hash determinism, dedup, immutability, ref atomicity (26)
├── dag-merge.test.ts        DAG/LCA, diff, conflicts, fast-forward, 3-way merge (29)
├── crdt-vcs-bridge.test.ts  atomic checkout/merge hydration, tab convergence, persistence (11)
├── seed.test.ts             demo DAG structure, conflict merge, force reset (5)
└── undo.test.ts             FileUndoManager scope, origin guards, checkout reset (5)

bench/
└── workspace.bench.ts       1k edits, SHA-256 tree hash, LCA + 3-way merge over 50-commit DAG
```

## Git Semantics

`Repository` merges by commit graph, not by text alone:

1. If the source is already an ancestor of `HEAD`, return `ALREADY_UP_TO_DATE`.
2. If `HEAD` is an ancestor of the source, fast-forward the branch ref and
   hydrate the working tree.
3. Otherwise compute the **lowest common ancestor** with bidirectional BFS.
   Candidates that are ancestors of other candidates are discarded, so
   criss-cross histories resolve deterministically.
4. Run a file-level three-way merge from the LCA tree, then a line-level diff3
   merge for files both sides changed.
5. Clean merges create a two-parent commit atomically with the ref update.
   Conflicts hydrate marker files, keep a pending merge session, and require
   `completeMergeCommit()` (or `abortMerge()`) before further mutations.

`checkout`, fast-forwards, and merges all reject dirty working trees with
`DirtyWorkingTreeError` unless `{ force: true }` is supplied.

## CRDT Working Tree and Cross-Tab Sync

`WorkingTreeDoc` stores every file as a `Y.Text` inside one
`Y.Doc`/`Y.Map<Y.Text>` and persists updates with `y-indexeddb`.
`hydrateFromTree()` replaces the complete working tree inside a single
`ydoc.transact(..., "checkout")`; checkout and merge therefore produce exactly
one update event, delete stale paths, and preserve the `Y.Text` identity of
unchanged files.

`TabSyncBridge` relays binary updates on
`BroadcastChannel("chronicle-crdt-sync")`:

- **Update relay:** local edits are broadcast as `Y.encodeStateAsUpdate()`;
  remote updates are applied with `Y.applyUpdate(ydoc, update, "broadcast")`.
- **No echo:** the `ydoc.on("update")` listener ignores the `"broadcast"`
  origin, the bridge itself, and the injected `IndexeddbPersistence` instance,
  so received state and IndexedDB replays are never re-broadcast.
- **Startup handshake:** every bridge posts `SYNC_STEP_1` with
  `Y.encodeStateVector(ydoc)`. Peers answer `SYNC_STEP_2` with
  `Y.encodeStateAsUpdate(ydoc, remoteVector)`, so a tab opened mid-session
  immediately receives uncommitted edits that predate its own bridge.
- **Startup ordering:** pass `ready: workingTree.whenSynced` (and
  `persistence: workingTree.persistence`) so a fresh tab does not answer a
  handshake with a not-yet-hydrated document. Messages received before
  readiness are queued.
- **Branch notifications:** `broadcastBranchChange()` mirrors the active branch
  across tabs for UI convergence.

### File-Scoped Undo

`FileUndoManager` wraps `Y.UndoManager` for exactly one `Y.Text`:
- Only transactions with origin `"local"` (editor keystrokes) are tracked.
- Remote `"broadcast"`, IndexedDB persistence, and `"checkout"` origins are
  ignored.
- On any `"checkout"` transaction the undo stack is cleared, so a branch switch
  never replays stale local edits.
- Switching files destroys the old manager and creates a fresh scope; undo
  history never leaks across files.

## Benchmarks

Run `npm run bench` (Vitest benchmark project, separate from unit tests).

| Benchmark | Configuration | Mean Latency | Throughput |
| :--- | :--- | :---: | :---: |
| **1,000 sequential Y.Text edits** | 1k inserts into one `Y.Text`, `LOCAL_EDIT_ORIGIN` | **2.14 ms** | **484 ops/s** |
| **SHA-256 tree hashing (100 files)** | 100 blobs → 1 tree, canonical JSON + Web Crypto | **1.69 ms** | **591 ops/s** |
| **LCA + 3-way merge (50-commit DAG)** | 30 main + 20 feature commits, overlapping edits | **0.37 ms** | **2,677 ops/s** |

<details>
<summary>Full verbose output</summary>

```
 RUN  v5.1.1 /Users/diwan/Developer/god-of-notes

 ✓ |bench| bench/workspace.bench.ts > workspace hot paths 3774ms
   name                               hz     min     max    mean     p75     p99    p995    p999     rme  samples
   1,000 sequential Y.Text edits  527.04  1.6710  3.2872  1.9386  2.0264  3.1021  3.1379  3.2607  ±1.43%      516

   name                                  hz     min     max    mean     p75     p99    p995    p999     rme  samples
   SHA-256 tree hashing (100 files)  599.68  1.5838  1.8070  1.6684  1.6835  1.7833  1.7910  1.8067  ±0.18%      600

   name                                     hz     min     max    mean     p75     p99    p995    p999     rme  samples
   LCA + 3-way merge (50-commit DAG)  2,611.53  0.3708  0.4797  0.3833  0.3835  0.4521  0.4570  0.4678  ±0.13%     2609
```

</details>

## Tradeoffs & Failure Modes

### 1. IndexedDB Quota Eviction

- **What happens:** Under storage pressure the browser may evict an origin's
  IndexedDB data without warning. `navigator.storage.estimate()` in the X-Ray
  drawer surfaces `usage` vs `quota` so the workspace can warn at ~80% pressure.
- **Mitigation:** The CAS layer is content-addressable; identical blobs across
  commits deduplicate to a single physical copy. A 50-commit history with many
  shared files typically achieves 30–50% deduplication (see benchmarks).
- **Failure mode:** If eviction occurs, `y-indexeddb` reinitializes with an
  empty document. The next `Repository.init()` will see no `RefState` and
  `seedDemoRepo(force: true)` can reseed the fixture. User edits since the
  last successful commit are lost—this is why the UI encourages frequent
  commits and the command palette offers "Reset demo workspace" as a recovery
  path.

### 2. CRDT Tombstone Compaction

- **What happens:** Yjs retains delete tombstones forever to preserve
  convergence. Very long editing sessions on the same `Y.Text` grow the
  internal ID space and update size.
- **Mitigation:** The workspace uses one `Y.Text` per file. Typical
  documentation files stay well below the threshold where compaction matters.
  `y-indexeddb` stores incremental updates; a full document reload from
  IndexedDB replays the entire history, but this only happens once per tab
  startup.
- **Failure mode:** If a single file accumulates millions of operations, update
  messages sent over `BroadcastChannel` grow and may exceed the channel's
  message size limit (browser-dependent, typically ~256 KB). The current
  architecture does not implement `Y.Doc` compaction (`doc.gc()`) because it
  requires all peers to be online and coordinated. A future enhancement could
  trigger compaction on `checkout` when the working tree is atomically
  replaced.

### 3. BroadcastChannel Split-Brain Recovery

- **What happens:** Two tabs edit offline (or on different networks), the
  `BroadcastChannel` disconnects, and both diverge. When the channel
  reconnects, each tab sends its state vector; Yjs merges missing updates
  automatically.
- **Mitigation:** The `TabSyncBridge` handshake (`SYNC_STEP_1`/`SYNC_STEP_2`)
  guarantees that a tab opened after the divergence receives the union of both
  histories. The `broadcast` origin guard prevents echo storms.
- **Failure mode:** If both tabs make *conflicting* edits to the same character
  range in the same `Y.Text`, Yjs resolves them deterministically by Lamport
  timestamp (last-writer-wins per character). This is correct CRDT behaviour
  but may not match user intent. The workspace does not surface these
  micro-conflicts; they are resolved silently. For intentional semantic
  conflicts (e.g., two branches editing `docs/architecture.md` differently) the
  Git merge layer produces explicit conflict markers that the user must resolve
  in the DiffViewer.

### 4. Deterministic LCA with Criss-Cross Histories

- **What happens:** Two branches merge each other repeatedly (criss-cross),
  creating multiple lowest common ancestors at the same graph distance.
- **Mitigation:** `findLCA` uses bidirectional BFS to collect all common
  ancestors, then discards any candidate that is an ancestor of another
  candidate. Remaining candidates are ranked by (1) maximum distance from
  either tip, (2) sum of distances, (3) commit recency, (4) hash. This matches
  Git's `git merge-base --all` then `git merge-base --octopus` logic.
- **Failure mode:** Extremely deep criss-cross DAGs (hundreds of commits)
  increase BFS work. The current iterative DFS topological sort for
  `getCommitHistory` is O(V+E) and does not recurse, so stack overflow is not
  a concern.

### 5. Six Core Invariants

| # | Invariant | Enforced By |
| :--- | :--- | :--- |
| 1 | Canonical serialization before hashing | `canonicalStringify` in `hash.ts` |
| 2 | Content-addressable immutability | `IndexedDBObjectStorage.add` + `validateObject` |
| 3 | Pure core isolation | `src/core/` has zero React/UI imports; `IObjectStorage` boundary |
| 4 | Dirty working tree protection | `Repository.assertCleanWorkingTree` in checkout/merge |
| 5 | Deterministic merge base | `findLCA` bidirectional BFS in every non-fast-forward merge |
| 6 | Offline autonomy | Zero network calls; Web Crypto + IndexedDB + BroadcastChannel only |

## Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start Vite dev server |
| `npm test` | Run Vitest suite once (76 tests) |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run bench` | Run benchmarks with verbose reporter |
| `npm run typecheck` | Type-check without emitting |
| `npm run build` | Type-check and produce static production bundle |
| `npm run preview` | Preview production build |

## License

MIT — build your own local-first tools.