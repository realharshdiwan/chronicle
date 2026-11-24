# ARCHITECTURE SPECIFICATION: Local-First Git-Style Knowledge Workspace

> **INSTRUCTION TO AI CODING AGENT:** Read this entire specification before scaffolding or writing code. We are building a **greenfield, browser-native, local-first Git-style workspace** from scratch. Every architectural decision must prioritize $<1\text{ms}$ local persistence, cryptographic content addressability, deterministic CRDT cross-tab convergence, and complete offline autonomy.

---

## 1. System Vision & Engineering Objectives

Standard cloud note apps rely on mutable database rows and central servers, making offline work fragile and version history shallow. This application combines **two distributed systems primitives** directly inside the browser:

1. **Live CRDT Working Tree (`Yjs` + `y-indexeddb` + `BroadcastChannel`):** Powers zero-latency typing, automatic persistence, and real-time multi-tab synchronization without a backend.
2. **Immutable Content-Addressable Merkle-DAG (`IndexedDB` + `Web Crypto SHA-256`):** Implements true Git semantics—`Blob`, `Tree`, `Commit`, `Ref`, `branch`, `checkout`, `diff`, and Lowest Common Ancestor (LCA) **3-way merge** with conflict resolution.

### Target Engineering & Demo Outcomes

* **Zero-Login Instant Sandbox:** Visitors land directly inside a pre-seeded multi-branch repository with existing commit history, multiple branches, and an open feature branch ready for a 3-way merge demo.
* **True Structural Deduplication:** Identical document contents across branches and commits share a single SHA-256 `Blob` in IndexedDB.
* **Internals X-Ray HUD:** A collapsible diagnostic drawer exposes the live Merkle-DAG commit graph, raw logical bytes vs. deduplicated IndexedDB storage bytes, and keystroke-to-persist latency telemetry.
* **Zero Required Backend:** Deploys as a 100% static single-page bundle (`$0` hosting, zero API rate limits) while keeping a clean `ISyncTransport` interface ready for optional WebSocket state-vector relays.

---

## 2. Tech Stack

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Language & UI** | TypeScript (strict), React 19, Vite | Fast static build, strict algebraic types for DAG and merge states. |
| **Styling** | Tailwind CSS + Lucide Icons | Clean, high-contrast keyboard-first workspace (Linear/Obsidian aesthetic). |
| **Editor Surface** | CodeMirror 6 (`@codemirror/lang-markdown`) | Lightweight, virtualized viewport, supports custom diff decorations and keymaps. |
| **CRDT & Tab Sync** | `yjs`, `y-indexeddb`, native `BroadcastChannel` | Conflict-free live editing and instant multi-tab state convergence. |
| **Cryptography** | Native Web Crypto API (`crypto.subtle.digest`) | Hardware-accelerated SHA-256 hashing with zero external dependencies. |
| **Diff & Merge** | `diff` (Myers line diff) + custom 3-way merge | Deterministic line-level diffs and structured conflict hunk generation. |
| **Testing** | Vitest + `fake-indexeddb` | Fast unit and property tests for DAG invariants, LCA search, and merges. |

---

## 3. Repository Directory Structure

```text
local-first-git-workspace/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── ARCHITECTURE.md
├── README.md
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── core/                              # PURE TYPESCRIPT — ZERO React or DOM coupling
│   │   ├── types.ts                       # Blob, Tree, Commit, Ref, Diff, MergeResult, Telemetry
│   │   ├── cas/                           # Content-Addressable Object Store
│   │   │   ├── hash.ts                    # Canonical JSON serialization & SHA-256 Web Crypto helper
│   │   │   ├── ObjectStore.ts             # IObjectStorage interface + IndexedDB & InMemory adapters
│   │   │   └── telemetry.ts               # Tracks raw logical bytes vs deduplicated physical bytes
│   │   ├── vcs/                           # Version Control Engine (Git Semantics)
│   │   │   ├── Repository.ts              # init, status, commit, branch, checkout, log, reset
│   │   │   ├── dag.ts                     # Topological commit traversal & bidirectional BFS findLCA()
│   │   │   └── diff.ts                    # Myers line diff between Trees, Commits, and Working Tree
│   │   ├── merge/                         # 3-Way Merge & Conflict Resolution
│   │   │   ├── threeWayMerge.ts           # Base/Ours/Theirs file & line-level 3-way merge algorithm
│   │   │   └── conflictParser.ts          # Generates & resolves <<<<<<< / ======= / >>>>>>> hunks
│   │   ├── crdt/                          # Live Working Tree & Cross-Tab Convergence
│   │   │   ├── WorkingTreeDoc.ts          # Y.Doc wrapper (Y.Map<Y.Text>) + y-indexeddb persistence
│   │   │   └── TabSyncBridge.ts           # BroadcastChannel binary update relay across open tabs
│   │   └── seed/                          # First-Visit Demo Repository Seeder
│   │       └── seedDemoRepo.ts            # Populates initial commits, branches & mergeable conflict
│   ├── state/                             # Thin Reactive Bridge (Zustand / React Hooks)
│   │   └── useWorkspaceStore.ts           # Subscribes UI to WorkingTreeDoc & Repository events
│   └── ui/                                # Presentation Components
│       ├── layout/
│       │   ├── SidebarTree.tsx            # File explorer with M (Modified) / A (Added) / D (Deleted) badges
│       │   ├── TopBar.tsx                 # Active branch switcher, commit button, X-Ray toggle
│       │   └── CommandPalette.tsx         # Cmd+K palette (Commit, New Branch, Checkout, Merge, Twin Tab)
│       ├── editor/
│       │   ├── MarkdownEditor.tsx         # CodeMirror 6 bound directly to active file's Y.Text
│       │   └── DiffViewer.tsx             # Side-by-side / unified diff & interactive conflict resolver
│       └── xray/                          # Hire-Larp Systems Telemetry Drawer
│           ├── XRayDrawer.tsx             # Collapsible inspector container
│           ├── CommitDagGraph.tsx         # Interactive SVG Merkle-DAG (nodes, branches, HEAD, merges)
│           └── StorageMetricsCard.tsx     # Deduplication ratio, object counts & write latency sparkline
└── tests/
    ├── cas.test.ts                        # Hash determinism, deduplication & canonical key sorting
    ├── dag-merge.test.ts                  # Bidirectional BFS LCA, fast-forward & 3-way conflict merges
    └── crdt-vcs-bridge.test.ts            # Checkout hydration, dirty-tree guards & multi-doc sync
```

---

## 4. Core Data Models (`src/core/types.ts`)

```typescript
export type Sha256Hash = string; // 64-char lowercase hex digest

export interface BlobObject {
  type: "blob";
  hash: Sha256Hash;
  content: string;
  byteLength: number;
}

export interface TreeObject {
  type: "tree";
  hash: Sha256Hash;
  entries: Record<string, Sha256Hash>; // Sorted filePath -> blobHash
}

export interface CommitObject {
  type: "commit";
  hash: Sha256Hash;
  treeHash: Sha256Hash;
  parentHashes: Sha256Hash[]; // [] for root, [p1] for normal, [p1, p2] for merge commit
  message: string;
  author: string;
  timestamp: number;
}

export type StoredObject = BlobObject | TreeObject | CommitObject;

export interface RefState {
  head: { type: "branch"; name: string } | { type: "detached"; commitHash: Sha256Hash };
  branches: Record<string, Sha256Hash>; // branchName -> commitHash
}

export type FileChangeStatus = "ADDED" | "MODIFIED" | "DELETED" | "UNMODIFIED";

export interface WorkingFileDiff {
  path: string;
  status: FileChangeStatus;
  baseContent: string;
  workingContent: string;
}

export interface MergeConflictFile {
  path: string;
  baseContent: string;
  oursContent: string;
  theirsContent: string;
  mergedWithMarkers: string;
}

export type MergeOutcome =
  | { status: "ALREADY_UP_TO_DATE" }
  | { status: "FAST_FORWARD"; commitHash: Sha256Hash }
  | { status: "MERGED_CLEAN"; commitHash: Sha256Hash }
  | {
      status: "CONFLICT";
      sourceBranch: string;
      targetBranch: string;
      baseCommitHash: Sha256Hash;
      sourceCommitHash: Sha256Hash;
      resolvedFiles: Record<string, string>;
      conflictFiles: MergeConflictFile[];
    };

export interface StorageTelemetry {
  blobCount: number;
  treeCount: number;
  commitCount: number;
  logicalBytes: number;       // Sum of all file bytes across all historical commits
  deduplicatedBytes: number;  // Actual unique blob bytes stored in IndexedDB
  deduplicationRatio: number; // 1 - (deduplicatedBytes / logicalBytes)
  lastWriteLatencyMs: number;
}
```

---

## 5. Non-Negotiable Architectural Invariants

When writing or modifying code, **never violate these 6 invariants**:

1. **Invariant 1 — Canonical Serialization Before Hashing:** JavaScript object key iteration order can vary if keys are inserted dynamically. `hash.ts` **must** sort all object keys lexicographically (`Object.keys(obj).sort()`) before `JSON.stringify` and `SHA-256` hashing so identical logical trees or commits always produce the exact same hash.
2. **Invariant 2 — Content-Addressable Immutability:** Records in the `objects` store (`blobs`, `trees`, `commits`) are **write-once, never mutated, never overwritten**. Only `RefState` (`HEAD` and `branches`) mutates, and every ref update must execute inside an atomic IndexedDB transaction.
3. **Invariant 3 — Pure Core Isolation (`src/core/`):** Nothing inside `src/core/` may import `react`, `react-dom`, `lucide-react`, or touch `window.document`. Storage is accessed strictly through `IObjectStorage` (implemented by `IndexedDBObjectStorage` in production and `InMemoryObjectStorage` in Vitest).
4. **Invariant 4 — Dirty Working Tree Protection:** `Repository.checkout(branchName)` must compare the current `Y.Doc` file map against `HEAD`'s `TreeObject`. If uncommitted modifications exist, `checkout` must throw `DirtyWorkingTreeError` unless explicitly invoked with `{ force: true }`.
5. **Invariant 5 — Deterministic 3-Way Merge Base:** Every non-fast-forward merge must compute the **Lowest Common Ancestor (LCA)** via bidirectional BFS over `parentHashes` in `dag.ts`. Never diff `ours` directly against `theirs` without a common `base` tree.
6. **Invariant 6 — Offline Autonomy:** Every feature—including first-visit repository seeding, editing, branching, diffing, merging, and X-Ray telemetry—must work identically with `navigator.onLine === false`.

---

## 6. Phased Execution Plan (Follow Sequentially)

Execute one phase at a time. **Do not advance to the next phase** until the verification gate passes.

### Phase 1: Scaffold & Content-Addressable Object Store (`src/core/cas`)

* **Tasks:**
  1. Initialize Vite + React + TypeScript + Tailwind CSS + Vitest (`fake-indexeddb`, `yjs`, `y-indexeddb`, `diff`, `codemirror`, `@codemirror/lang-markdown`, `lucide-react`).
  2. Implement `src/core/cas/hash.ts` using Web Crypto (`crypto.subtle.digest("SHA-256", ...)`) with canonical sorted-key serialization.
  3. Implement `IObjectStorage` in `src/core/cas/ObjectStore.ts` with both `InMemoryObjectStorage` and `IndexedDBObjectStorage` (stores: `objects` keyed by `hash`, and `refs` storing singleton `RefState`), plus `telemetry.ts` to compute logical vs. deduplicated byte counts.
  4. Write `tests/cas.test.ts` verifying hash determinism, structural deduplication across identical blobs, and atomic ref updates.
* **Verification Gate:** `npx vitest run tests/cas.test.ts` passes with $100\%$ green assertions.

### Phase 2: VCS Engine, Bidirectional BFS LCA & 3-Way Merge (`src/core/vcs`, `src/core/merge`)

* **Tasks:**
  1. Implement `src/core/vcs/dag.ts` with topological history traversal (`getCommitHistory`) and bidirectional BFS `findLCA(commitA, commitB)`.
  2. Implement `src/core/vcs/diff.ts` using Myers line diff to compute `WorkingFileDiff[]` between any two trees or between `HEAD` and a working file map.
  3. Implement `src/core/merge/threeWayMerge.ts` and `conflictParser.ts`: given `baseTree`, `oursTree`, and `theirsTree`, auto-merge non-overlapping changes and emit standard `<<<<<<< HEAD` / `=======` / `>>>>>>> branch` markers on overlapping line ranges.
  4. Implement `src/core/vcs/Repository.ts` orchestrating `init`, `status`, `commit`, `createBranch`, `checkout`, `merge`, and `completeMergeCommit`.
  5. Write `tests/dag-merge.test.ts` testing linear commits, branching, fast-forward merge, clean 3-way merge, conflicting 3-way merge, and dirty checkout rejection.
* **Verification Gate:** `npx vitest run tests/dag-merge.test.ts` passes cleanly.

### Phase 3: CRDT Working Tree & Cross-Tab Sync Bridge (`src/core/crdt`)

* **Tasks:**
  1. Implement `WorkingTreeDoc.ts` wrapping a `Y.Doc` (`yDoc.getMap<Y.Text>("files")`) synchronized to IndexedDB via `y-indexeddb`.
  2. Implement `TabSyncBridge.ts` using `BroadcastChannel("chronicle-crdt-sync")` to broadcast incremental Yjs binary state updates (`Y.encodeStateAsUpdate`) and active branch change notifications across open tabs.
  3. Implement `hydrateFromTree(treeFiles: Record<string, string>)` inside `WorkingTreeDoc.ts` using a single `yDoc.transact(...)` batch so `checkout` atomically replaces editor buffers without triggering spurious history loops.
  4. Write `tests/crdt-vcs-bridge.test.ts` verifying two `WorkingTreeDoc` instances converging via binary updates and cleanly hydrating on branch `checkout`.
* **Verification Gate:** `npx vitest run` passes all unit and integration tests.

### Phase 4: Pre-Seeded Demo Repo & Workspace UI (`src/core/seed`, `src/ui`)

* **Tasks:**
  1. Implement `seedDemoRepo.ts`: on first launch (when `RefState` does not exist), create a realistic 4-commit repository on `main` (e.g., an engineering RFC / system design workspace with 3 Markdown files) plus a diverged `feat/distributed-cache` branch containing both auto-mergeable edits and one intentional line conflict so visitors can test `DiffViewer` and `Merge` immediately.
  2. Build `SidebarTree.tsx` showing workspace files with live `M` / `A` / `D` status indicators and a `+ New File` action.
  3. Build `MarkdownEditor.tsx` binding CodeMirror 6 to the active file's `Y.Text` instance and recording keystroke-to-persist latency into telemetry.
  4. Build `TopBar.tsx`, `CommandPalette.tsx` (`Cmd+K`), and `DiffViewer.tsx` (with one-click **"Accept Ours"**, **"Accept Theirs"**, and **"Commit Merge"** buttons when resolving conflicts).
* **Verification Gate:** App boots with zero login screen, edits persist across page reloads in $<1\text{ms}$, and opening two browser tabs mirrors keystrokes in real time.

### Phase 5: Internals X-Ray Drawer & Architecture README (`src/ui/xray`)

* **Tasks:**
  1. Build `CommitDagGraph.tsx`: an interactive SVG visualization of the Merkle-DAG displaying commit hashes (7-char short SHA), commit messages, parent edges (including two-parent merge edges), branch badges, and `HEAD` indicator; clicking any node opens its commit snapshot diff.
  2. Build `StorageMetricsCard.tsx`: displays live `Blob` / `Tree` / `Commit` object counts, raw logical bytes vs. deduplicated IndexedDB bytes (`deduplicationRatio` percentage), and a latency sparkline.
  3. Add a **"Open Synced Twin Tab"** button inside `XRayDrawer.tsx` so reviewers can verify cross-tab CRDT convergence in one click.
  4. Write a comprehensive `README.md` featuring a system architecture diagram, Merkle-DAG data model explanation, 3-way merge LCA overview, and failure-mode tradeoffs (e.g., CRDT state compaction vs. immutable CAS snapshots).
* **Verification Gate:** `npm run build` succeeds with zero TypeScript errors, and all interactive X-Ray and merge flows work offline.

---

## 7. Agent Working Rules

* **First Action:** Inspect the directory (if empty, initialize the Vite + React + TypeScript project) and begin **Phase 1** by creating `src/core/types.ts`, `src/core/cas/hash.ts`, `src/core/cas/ObjectStore.ts`, and `tests/cas.test.ts`.
* **Verify Before Advancing:** Run Vitest after each core phase and fix any edge cases before building UI components.
* **Keep UI Focused:** Prioritize crisp typography, dark/light theme support, and instant responsiveness over decorative bloat—the **Internals X-Ray** drawer and **3-Way Merge** flow are the centerpiece features.