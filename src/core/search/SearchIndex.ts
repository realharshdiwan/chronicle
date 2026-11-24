import type { IObjectStorage } from '../cas/ObjectStore';
import type { BlobObject, CommitObject, RefState, TreeObject } from '../types';

export interface PostingEntry {
  blobHash: string;
  tf: number;
  lines: number[];
}

export interface IndexedBlobMeta {
  blobHash: string;
  byteLength: number;
  tokenCount: number;
  indexedAt: number;
}

export interface SearchOccurrence {
  path: string;
  source: 'working-tree' | 'commit';
  commitHash?: string;
  commitMessage?: string;
  branchNames: string[];
}

export interface SearchMatchRange {
  start: number;
  end: number;
}

export interface SearchSnippet {
  lineNumber: number;
  lineText: string;
  highlights: SearchMatchRange[];
}

export interface SearchResult {
  blobHash: string;
  score: number;
  matchedTerms: string[];
  occurrences: SearchOccurrence[];
  snippets: SearchSnippet[];
  byteLength: number;
}

export interface SearchIndexStats {
  indexedBlobCount: number;
  tokenCount: number;
}

export interface ISearchIndexStorage {
  getPostingList(token: string): Promise<PostingEntry[] | null>;
  getPostingListsByPrefix(
    prefix: string,
    limit?: number
  ): Promise<Map<string, PostingEntry[]>>;
  putPostingLists(updates: Map<string, PostingEntry[]>): Promise<void>;
  getAllIndexedBlobMeta(): Promise<Map<string, IndexedBlobMeta>>;
  putIndexedBlobMeta(entries: IndexedBlobMeta[]): Promise<void>;
  getStats(): Promise<SearchIndexStats>;
  clear(): Promise<void>;
  close(): void;
}

/**
 * Pure in-memory inverted index storage for Node unit tests and isolated execution.
 */
export class InMemorySearchIndexStorage implements ISearchIndexStorage {
  private postings = new Map<string, PostingEntry[]>();
  private blobs = new Map<string, IndexedBlobMeta>();

  async getPostingList(token: string): Promise<PostingEntry[] | null> {
    const list = this.postings.get(token);
    return list ? list.map((e) => ({ ...e, lines: [...e.lines] })) : null;
  }

  async getPostingListsByPrefix(
    prefix: string,
    limit = 24
  ): Promise<Map<string, PostingEntry[]>> {
    const out = new Map<string, PostingEntry[]>();
    if (!prefix) return out;
    const keys = Array.from(this.postings.keys())
      .filter((k) => k.startsWith(prefix))
      .sort()
      .slice(0, limit);
    for (const k of keys) {
      const list = this.postings.get(k)!;
      out.set(
        k,
        list.map((e) => ({ ...e, lines: [...e.lines] }))
      );
    }
    return out;
  }

  async putPostingLists(updates: Map<string, PostingEntry[]>): Promise<void> {
    for (const [token, entries] of updates.entries()) {
      this.postings.set(
        token,
        entries.map((e) => ({ ...e, lines: [...e.lines] }))
      );
    }
  }

  async getAllIndexedBlobMeta(): Promise<Map<string, IndexedBlobMeta>> {
    const copy = new Map<string, IndexedBlobMeta>();
    for (const [k, v] of this.blobs.entries()) {
      copy.set(k, { ...v });
    }
    return copy;
  }

  async putIndexedBlobMeta(entries: IndexedBlobMeta[]): Promise<void> {
    for (const item of entries) {
      this.blobs.set(item.blobHash, { ...item });
    }
  }

  async getStats(): Promise<SearchIndexStats> {
    return {
      indexedBlobCount: this.blobs.size,
      tokenCount: this.postings.size,
    };
  }

  async clear(): Promise<void> {
    this.postings.clear();
    this.blobs.clear();
  }

  close(): void {
    // No-op
  }
}

const SEARCH_DB_NAME = 'chronicle-search-index-db';
const SEARCH_DB_VERSION = 1;
const STORE_POSTINGS = 'postings';
const STORE_INDEXED_BLOBS = 'indexed_blobs';

interface StoredPostingRecord {
  token: string;
  entries: PostingEntry[];
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error('IndexedDB search request failed'));
  });
}

function idbTransactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error('IndexedDB search transaction failed'));
    tx.onabort = () =>
      reject(tx.error ?? new Error('IndexedDB search transaction aborted'));
  });
}

/**
 * Browser-native IndexedDB inverted index storage using B-tree key ranges
 * for fast exact and prefix lookups across all repository blobs.
 */
export class IndexedDBSearchIndexStorage implements ISearchIndexStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private dbName: string;

  constructor(dbName = SEARCH_DB_NAME) {
    this.dbName = dbName;
  }

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, SEARCH_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_POSTINGS)) {
          db.createObjectStore(STORE_POSTINGS, { keyPath: 'token' });
        }
        if (!db.objectStoreNames.contains(STORE_INDEXED_BLOBS)) {
          db.createObjectStore(STORE_INDEXED_BLOBS, { keyPath: 'blobHash' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        this.dbPromise = null;
        reject(req.error ?? new Error('Failed to open IndexedDB search store'));
      };
    });
    return this.dbPromise;
  }

  async getPostingList(token: string): Promise<PostingEntry[] | null> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_POSTINGS, 'readonly');
    const rec = await idbRequest<StoredPostingRecord | undefined>(
      tx.objectStore(STORE_POSTINGS).get(token)
    );
    return rec ? rec.entries : null;
  }

  async getPostingListsByPrefix(
    prefix: string,
    limit = 24
  ): Promise<Map<string, PostingEntry[]>> {
    const out = new Map<string, PostingEntry[]>();
    if (!prefix) return out;
    const db = await this.openDB();
    const tx = db.transaction(STORE_POSTINGS, 'readonly');
    const store = tx.objectStore(STORE_POSTINGS);
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);

    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || out.size >= limit) {
          resolve();
          return;
        }
        const rec = cursor.value as StoredPostingRecord;
        out.set(rec.token, rec.entries);
        cursor.continue();
      };
      cursorReq.onerror = () =>
        reject(cursorReq.error ?? new Error('Prefix cursor lookup failed'));
    });

    return out;
  }

  async putPostingLists(updates: Map<string, PostingEntry[]>): Promise<void> {
    if (updates.size === 0) return;
    const db = await this.openDB();
    const tx = db.transaction(STORE_POSTINGS, 'readwrite');
    const store = tx.objectStore(STORE_POSTINGS);
    for (const [token, entries] of updates.entries()) {
      store.put({ token, entries } satisfies StoredPostingRecord);
    }
    await idbTransactionDone(tx);
  }

  async getAllIndexedBlobMeta(): Promise<Map<string, IndexedBlobMeta>> {
    const db = await this.openDB();
    const tx = db.transaction(STORE_INDEXED_BLOBS, 'readonly');
    const list = await idbRequest<IndexedBlobMeta[]>(
      tx.objectStore(STORE_INDEXED_BLOBS).getAll()
    );
    const map = new Map<string, IndexedBlobMeta>();
    for (const item of list) {
      map.set(item.blobHash, item);
    }
    return map;
  }

  async putIndexedBlobMeta(entries: IndexedBlobMeta[]): Promise<void> {
    if (entries.length === 0) return;
    const db = await this.openDB();
    const tx = db.transaction(STORE_INDEXED_BLOBS, 'readwrite');
    const store = tx.objectStore(STORE_INDEXED_BLOBS);
    for (const item of entries) {
      store.put(item);
    }
    await idbTransactionDone(tx);
  }

  async getStats(): Promise<SearchIndexStats> {
    const db = await this.openDB();
    const tx = db.transaction(
      [STORE_INDEXED_BLOBS, STORE_POSTINGS],
      'readonly'
    );
    const [blobCount, tokenCount] = await Promise.all([
      idbRequest<number>(tx.objectStore(STORE_INDEXED_BLOBS).count()),
      idbRequest<number>(tx.objectStore(STORE_POSTINGS).count()),
    ]);
    return { indexedBlobCount: blobCount, tokenCount };
  }

  async clear(): Promise<void> {
    const db = await this.openDB();
    const tx = db.transaction(
      [STORE_POSTINGS, STORE_INDEXED_BLOBS],
      'readwrite'
    );
    tx.objectStore(STORE_POSTINGS).clear();
    tx.objectStore(STORE_INDEXED_BLOBS).clear();
    await idbTransactionDone(tx);
  }

  close(): void {
    if (this.dbPromise) {
      this.dbPromise.then((db) => db.close()).catch(() => undefined);
      this.dbPromise = null;
    }
  }
}

/**
 * Tokenizes text into normalized search terms while splitting camelCase and
 * compound identifiers (e.g. `WorkingTreeDoc` -> `workingtreedoc`, `working`, `tree`, `doc`).
 */
export function tokenizeText(text: string): string[] {
  const tokens: string[] = [];
  const rawMatches = text.match(/[A-Za-z0-9_]{2,}/g);
  if (!rawMatches) return tokens;

  for (const raw of rawMatches) {
    const lower = raw.toLowerCase();
    tokens.push(lower);

    // Split snake_case & camelCase sub-tokens for natural code/doc search
    const parts = raw
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[_\s]+/)
      .map((p) => p.toLowerCase())
      .filter((p) => p.length >= 2);

    if (parts.length > 1) {
      for (const p of parts) {
        if (p !== lower) tokens.push(p);
      }
    }
  }
  return tokens;
}

export function tokenizeQuery(query: string): string[] {
  const seen = new Set<string>();
  const matches = query.toLowerCase().match(/[a-z0-9]{2,}|[a-z0-9]/g);
  if (!matches) return [];
  for (const m of matches) {
    if (m.length >= 2) seen.add(m);
  }
  // If user only typed a single character, allow single-char prefix lookup
  if (seen.size === 0 && matches.length > 0) {
    seen.add(matches[0]);
  }
  return Array.from(seen);
}

interface BlobOccurrenceIndex {
  byBlobHash: Map<string, SearchOccurrence[]>;
  blobByHash: Map<string, BlobObject>;
}

async function buildBlobOccurrenceIndex(
  casStorage: IObjectStorage,
  refs: RefState | null,
  workingTreeFiles: Record<string, string>
): Promise<BlobOccurrenceIndex> {
  const allObjects = await casStorage.getAllObjects();
  const blobByHash = new Map<string, BlobObject>();
  const treeByHash = new Map<string, TreeObject>();
  const commits: CommitObject[] = [];

  for (const obj of allObjects) {
    if (obj.type === 'blob') blobByHash.set(obj.hash, obj);
    else if (obj.type === 'tree') treeByHash.set(obj.hash, obj);
    else if (obj.type === 'commit') commits.push(obj);
  }

  const branchByCommit = new Map<string, string[]>();
  if (refs) {
    for (const [branch, hash] of Object.entries(refs.branches)) {
      const list = branchByCommit.get(hash) ?? [];
      list.push(branch);
      branchByCommit.set(hash, list);
    }
  }

  const byBlobHash = new Map<string, SearchOccurrence[]>();

  // 1. Live working tree occurrences
  // Check if live content matches any CAS blob content by exact string match
  const contentToBlobHashes = new Map<string, string[]>();
  for (const blob of blobByHash.values()) {
    const list = contentToBlobHashes.get(blob.content) ?? [];
    list.push(blob.hash);
    contentToBlobHashes.set(blob.content, list);
  }

  for (const [path, content] of Object.entries(workingTreeFiles)) {
    const matchingHashes = contentToBlobHashes.get(content) ?? [];
    for (const hash of matchingHashes) {
      const list = byBlobHash.get(hash) ?? [];
      list.push({
        path,
        source: 'working-tree',
        branchNames:
          refs?.head.type === 'branch' ? [refs.head.branch] : ['HEAD'],
      });
      byBlobHash.set(hash, list);
    }
  }

  // 2. Historical commit occurrences (newest commits first)
  const sortedCommits = [...commits].sort((a, b) => b.timestamp - a.timestamp);
  for (const commit of sortedCommits) {
    const tree = treeByHash.get(commit.treeHash);
    if (!tree) continue;
    const branches = branchByCommit.get(commit.hash) ?? [];
    for (const [path, blobHash] of Object.entries(tree.entries)) {
      const list = byBlobHash.get(blobHash) ?? [];
      // Avoid duplicating identical (path, blobHash) across non-branch-tip commits if we already have >= 3 occurrences
      const existingSamePath = list.some(
        (occ) => occ.source === 'commit' && occ.path === path
      );
      if (!existingSamePath || branches.length > 0) {
        list.push({
          path,
          source: 'commit',
          commitHash: commit.hash,
          commitMessage: commit.message,
          branchNames: branches,
        });
        byBlobHash.set(blobHash, list);
      }
    }
  }

  return { byBlobHash, blobByHash };
}

function extractSnippets(
  content: string,
  queryTerms: string[],
  maxSnippets = 3
): SearchSnippet[] {
  if (!content || queryTerms.length === 0) return [];
  const lines = content.split('\n');
  const snippets: SearchSnippet[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    const ranges: SearchMatchRange[] = [];

    for (const term of queryTerms) {
      let searchFrom = 0;
      while (searchFrom < lower.length) {
        const idx = lower.indexOf(term, searchFrom);
        if (idx === -1) break;
        ranges.push({ start: idx, end: idx + term.length });
        searchFrom = idx + term.length;
      }
    }

    if (ranges.length > 0) {
      // Merge overlapping highlight ranges
      ranges.sort((a, b) => a.start - b.start || a.end - b.end);
      const merged: SearchMatchRange[] = [];
      for (const r of ranges) {
        const prev = merged[merged.length - 1];
        if (prev && r.start <= prev.end) {
          prev.end = Math.max(prev.end, r.end);
        } else {
          merged.push({ ...r });
        }
      }
      snippets.push({
        lineNumber: i + 1,
        lineText: line,
        highlights: merged,
      });
      if (snippets.length >= maxSnippets) break;
    }
  }

  return snippets;
}

/**
 * Repository inverted-index search engine backed by IndexedDB (or InMemory storage).
 * Incrementally indexes immutable CAS BlobObjects once per SHA-256 hash.
 */
export class RepositorySearchEngine {
  private casStorage: IObjectStorage;
  private indexStorage: ISearchIndexStorage;
  private syncPromise: Promise<SearchIndexStats> | null = null;

  constructor(
    casStorage: IObjectStorage,
    indexStorage: ISearchIndexStorage
  ) {
    this.casStorage = casStorage;
    this.indexStorage = indexStorage;
  }

  /**
   * Synchronizes the IndexedDB inverted index with all CAS blobs.
   * Because CAS blobs are immutable by SHA-256 hash, already-indexed blobs are skipped.
   */
  syncIndex(): Promise<SearchIndexStats> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.runSyncIndex().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  private async runSyncIndex(): Promise<SearchIndexStats> {
    const [allObjects, indexedMeta] = await Promise.all([
      this.casStorage.getAllObjects(),
      this.indexStorage.getAllIndexedBlobMeta(),
    ]);

    const newBlobs = allObjects.filter(
      (obj): obj is BlobObject =>
        obj.type === 'blob' && !indexedMeta.has(obj.hash)
    );

    if (newBlobs.length === 0) {
      return this.indexStorage.getStats();
    }

    // Aggregate per-token postings for newly discovered blobs
    const newPostingsByToken = new Map<string, PostingEntry[]>();
    const newMetaEntries: IndexedBlobMeta[] = [];
    const now = Date.now();

    for (const blob of newBlobs) {
      const lines = blob.content.split('\n');
      const tokenFreq = new Map<string, number>();
      const tokenLines = new Map<string, Set<number>>();
      let totalTokens = 0;

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const lineTokens = tokenizeText(lines[lineIdx]);
        totalTokens += lineTokens.length;
        for (const tok of lineTokens) {
          tokenFreq.set(tok, (tokenFreq.get(tok) ?? 0) + 1);
          let lineSet = tokenLines.get(tok);
          if (!lineSet) {
            lineSet = new Set<number>();
            tokenLines.set(tok, lineSet);
          }
          lineSet.add(lineIdx + 1);
        }
      }

      for (const [tok, tf] of tokenFreq.entries()) {
        const entry: PostingEntry = {
          blobHash: blob.hash,
          tf,
          lines: Array.from(tokenLines.get(tok) ?? []).slice(0, 20),
        };
        const list = newPostingsByToken.get(tok) ?? [];
        list.push(entry);
        newPostingsByToken.set(tok, list);
      }

      newMetaEntries.push({
        blobHash: blob.hash,
        byteLength: blob.byteLength,
        tokenCount: totalTokens,
        indexedAt: now,
      });
    }

    // Merge with existing postings in IndexedDB for touched tokens
    const mergedUpdates = new Map<string, PostingEntry[]>();
    for (const [token, addedEntries] of newPostingsByToken.entries()) {
      const existing = (await this.indexStorage.getPostingList(token)) ?? [];
      const byHash = new Map<string, PostingEntry>();
      for (const e of existing) byHash.set(e.blobHash, e);
      for (const e of addedEntries) byHash.set(e.blobHash, e);
      mergedUpdates.set(token, Array.from(byHash.values()));
    }

    await this.indexStorage.putPostingLists(mergedUpdates);
    await this.indexStorage.putIndexedBlobMeta(newMetaEntries);

    return this.indexStorage.getStats();
  }

  /**
   * Executes a full-text search across all indexed CAS blobs (and uncommitted
   * working-tree edits) using BM25/TF-IDF ranking + prefix cursor lookups.
   */
  async search(params: {
    query: string;
    refs: RefState | null;
    workingTreeFiles: Record<string, string>;
    scope?: 'all' | 'working-tree';
    limit?: number;
  }): Promise<SearchResult[]> {
    const { query, refs, workingTreeFiles, scope = 'all', limit = 30 } = params;
    const queryTerms = tokenizeQuery(query);
    if (queryTerms.length === 0) return [];

    await this.syncIndex();

    const [indexedMeta, occIndex] = await Promise.all([
      this.indexStorage.getAllIndexedBlobMeta(),
      buildBlobOccurrenceIndex(this.casStorage, refs, workingTreeFiles),
    ]);

    const totalDocs = Math.max(1, indexedMeta.size);
    const avgDocLen =
      Array.from(indexedMeta.values()).reduce(
        (acc, m) => acc + m.tokenCount,
        0
      ) / totalDocs || 50;

    // Score accumulator per blobHash
    const scores = new Map<string, number>();
    const matchedTermsMap = new Map<string, Set<string>>();

    for (const term of queryTerms) {
      const exactPostings = await this.indexStorage.getPostingList(term);
      const prefixMap = await this.indexStorage.getPostingListsByPrefix(term, 16);

      // Combine exact (weight 1.0) and prefix matches (weight 0.65)
      const combined = new Map<string, { tf: number; weight: number }>();

      if (exactPostings) {
        const idf = Math.log(
          1 + (totalDocs - exactPostings.length + 0.5) / (exactPostings.length + 0.5)
        );
        for (const p of exactPostings) {
          combined.set(p.blobHash, { tf: p.tf, weight: idf * 1.35 });
        }
      }

      for (const [matchedToken, entries] of prefixMap.entries()) {
        if (matchedToken === term) continue;
        const idf = Math.log(
          1 + (totalDocs - entries.length + 0.5) / (entries.length + 0.5)
        );
        for (const p of entries) {
          if (!combined.has(p.blobHash)) {
            combined.set(p.blobHash, { tf: p.tf, weight: idf * 0.7 });
          }
        }
      }

      for (const [blobHash, info] of combined.entries()) {
        const docLen = indexedMeta.get(blobHash)?.tokenCount ?? avgDocLen;
        const k1 = 1.2;
        const b = 0.75;
        const tfNorm =
          (info.tf * (k1 + 1)) /
          (info.tf + k1 * (1 - b + b * (docLen / Math.max(1, avgDocLen))));
        const termScore = info.weight * tfNorm;

        scores.set(blobHash, (scores.get(blobHash) ?? 0) + termScore);
        let set = matchedTermsMap.get(blobHash);
        if (!set) {
          set = new Set<string>();
          matchedTermsMap.set(blobHash, set);
        }
        set.add(term);
      }
    }

    const results: SearchResult[] = [];

    for (const [blobHash, rawScore] of scores.entries()) {
      const blob = occIndex.blobByHash.get(blobHash);
      if (!blob) continue;

      let occurrences = occIndex.byBlobHash.get(blobHash) ?? [];
      if (scope === 'working-tree') {
        occurrences = occurrences.filter((o) => o.source === 'working-tree');
        if (occurrences.length === 0) continue;
      }

      const matchedTerms = Array.from(matchedTermsMap.get(blobHash) ?? []);
      // Bonus for matching multiple query terms and for live working-tree blobs
      const multiTermBonus = matchedTerms.length / queryTerms.length;
      const liveBonus = occurrences.some((o) => o.source === 'working-tree')
        ? 1.15
        : 1.0;
      const finalScore = Number(
        (rawScore * (0.6 + 0.4 * multiTermBonus) * liveBonus).toFixed(3)
      );

      results.push({
        blobHash,
        score: finalScore,
        matchedTerms,
        occurrences,
        snippets: extractSnippets(blob.content, queryTerms, 3),
        byteLength: blob.byteLength,
      });
    }

    // Also include uncommitted working-tree files that aren't yet committed to CAS
    const indexedLiveContents = new Set<string>();
    for (const r of results) {
      if (r.occurrences.some((o) => o.source === 'working-tree')) {
        const b = occIndex.blobByHash.get(r.blobHash);
        if (b) indexedLiveContents.add(b.content);
      }
    }

    for (const [path, content] of Object.entries(workingTreeFiles)) {
      if (indexedLiveContents.has(content)) continue;
      // Check if content matches an already-found CAS blob via path
      const lower = content.toLowerCase();
      const matched = queryTerms.filter((t) => lower.includes(t));
      if (matched.length === 0) continue;

      const snippets = extractSnippets(content, queryTerms, 3);
      if (snippets.length === 0) continue;

      results.push({
        blobHash: `uncommitted:${path}`,
        score: Number((1.5 * (matched.length / queryTerms.length)).toFixed(3)),
        matchedTerms: matched,
        occurrences: [
          {
            path,
            source: 'working-tree',
            branchNames:
              refs?.head.type === 'branch' ? [refs.head.branch] : ['HEAD'],
          },
        ],
        snippets,
        byteLength: new TextEncoder().encode(content).byteLength,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
