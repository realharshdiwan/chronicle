# Chronicle

**Chronicle** is a zero-login, browser-native, local-first Markdown knowledge workspace that pairs a **live CRDT working tree** with an **immutable SHA-256 Content-Addressable Merkle-DAG**—running 100% client-side with offline PWA support.

---

## Why Chronicle Exists (Not Just Another Text Editor)

Most browser note apps store a single mutable blob in `localStorage` or lock your history behind a cloud account. Chronicle brings **real Git version control** and **multi-tab CRDT collaboration** directly into the browser with zero servers:

- **Immutable History & Deduplication**: Every commit writes canonical JSON-serialized `blob`, `tree`, and `commit` objects keyed by Web Crypto `SHA-256` into IndexedDB. Unchanged files are automatically deduplicated across branches and commits.
- **Real Branching, Diffing & 3-Way LCA Merging**: Create branches, protect uncommitted edits with dirty-working-tree checks, inspect Myers line diffs, and resolve true 3-way merge conflicts computed via bidirectional BFS Lowest Common Ancestor (`findLCA`).
- **Real-Time Multi-Tab CRDT Working Tree**: Powered by `Yjs` + `y-indexeddb` + `BroadcastChannel` (`SYNC_STEP_1` / `SYNC_STEP_2`) with transaction-origin isolation so remote sibling-tab edits never pollute your local undo/redo stack.
- **Persistent Full-Text Search Across Time**: An incremental inverted index stored in IndexedDB (`chronicle-search-index-db`) indexes every historical commit blob and blends live uncommitted drafts using prefix B-tree cursors and TF-IDF/BM25 scoring.
- **Multi-Workspace Notebooks & Portable Backups**: Switch between isolated local notebooks, share sanitized workspace snapshots as compressed URL fragments, or export/import full `.zip` and `.json` archives (plus drag-and-drop Markdown folders) with zero size limits.
- **Installable Offline PWA**: Pre-caches all application assets via `vite-plugin-pwa` (Workbox) so Chronicle launches and operates cleanly offline.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                   React 19 + Vite + Tailwind CSS                     │
│  Editor (CodeMirror 6) · DiffViewer · XRayDrawer · Search · Modals   │
└──────────────────────────────────┬───────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Zustand Store (src/state/workspace.ts)              │
│   Multi-workspace lifecycle, refs, branches, diffs, search, export   │
└──────────────────────────────────┬───────────────────────────────────┘
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   src/core/ — Pure TypeScript Engine                 │
│  cas/        Canonical SHA-256 hashing, write-once ObjectStore,      │
│              deduplication & write-latency telemetry                 │
│  vcs/        Repository (init, commit, branch, delete, checkout,     │
│              Myers diff, bidirectional-BFS LCA, 3-way merge)         │
│  crdt/       Yjs WorkingTreeDoc, TabSyncBridge, per-file UndoManager │
│  search/     Incremental inverted index + prefix cursor + BM25       │
│  share/      Compressed URL-fragment bundling + secret redaction     │
│  archive/    Full .zip / .json backup & folder/file drop import      │
│  workspace/  Isolated multi-workspace registry & author settings     │
└──────────────┬───────────────────────────┬───────────────────────────┘
               ▼                           ▼
          IndexedDB                 BroadcastChannel
   (CAS + Search + Yjs)             (Real-time tab sync)
```

### Core Architectural Invariants

1. **Canonical Serialization**: Object keys are sorted deterministically prior to `SHA-256` hashing (`src/core/cas/hash.ts`).
2. **Write-Once CAS & Atomic Refs**: Stored objects are immutable once written; branch/HEAD ref updates occur atomically.
3. **Pure Core Isolation**: `src/core/` contains zero React or DOM dependencies, enabling deterministic Node.js unit testing via `IObjectStorage` and `ISearchIndexStorage` interfaces.
4. **Dirty Working Tree Guard**: Branch switches and merges refuse to overwrite uncommitted local changes.
5. **Client-Side Privacy**: Share links automatically exclude `.env`/key files and redact credential patterns before compression.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Cmd/Ctrl + K` | Open Command Palette |
| `Cmd/Ctrl + Shift + F` | Open Full-Text Repository Search |
| `Escape` | Close active modal or drawer |

---

## Local Development & Verification

```bash
# Install dependencies
npm install

# Start development server on http://localhost:3000
npm run dev

# Run all core unit tests (node:test via tsx)
npm test

# Type-check with TypeScript
npm run lint

# Build production PWA bundle
npm run build
```

### Unit Test Suites

Tests use `node:test` + `node:assert/strict` and run in memory without browser overhead:

- `src/core/cas/cas.test.ts` — Canonical hashing, CAS immutability, deduplication telemetry
- `src/core/vcs/vcs.test.ts` — Dirty-tree guards, LCA resolution, Myers diff, 3-way merge & branch deletion
- `src/core/crdt/crdt.test.ts` — Atomic hydration, file rename, undo isolation, two-tab CRDT convergence
- `src/core/search/SearchIndex.test.ts` — Sub-tokenization, incremental indexing, prefix search, uncommitted drafts
- `src/core/share/shareLink.test.ts` — Secret redaction, compression round-trip, tamper rejection
- `src/core/archive/repoArchive.test.ts` — Full `.json` & `.zip` backup round-trips and path-traversal protection
- `src/core/workspace/WorkspaceRegistry.test.ts` — Multi-workspace lifecycle & author identity persistence
- `src/core/seed/seedDemoRepo.test.ts` — Deterministic 5-commit demo repository verification
- `src/utils/markdownParser.test.ts` — Markdown block parsing & safe URL sanitization
