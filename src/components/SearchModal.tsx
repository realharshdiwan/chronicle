import { useEffect, useRef, type ReactNode } from 'react';
import {
  Database,
  FileText,
  GitCommitHorizontal,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { SearchMatchRange } from '../core/search/SearchIndex';
import { useWorkspaceStore, type SearchScope } from '../state/workspace';

function renderHighlightedLine(
  lineText: string,
  highlights: SearchMatchRange[],
  keyPrefix: string
): ReactNode[] {
  if (highlights.length === 0) {
    return [<span key={`${keyPrefix}-full`}>{lineText}</span>];
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;

  highlights.forEach((range, idx) => {
    const start = Math.max(cursor, Math.min(lineText.length, range.start));
    const end = Math.max(start, Math.min(lineText.length, range.end));

    if (start > cursor) {
      nodes.push(
        <span key={`${keyPrefix}-t-${idx}`}>{lineText.slice(cursor, start)}</span>
      );
    }
    if (end > start) {
      nodes.push(
        <mark
          key={`${keyPrefix}-m-${idx}`}
          className="rounded px-0.5 bg-cyan-400/30 text-cyan-100 ring-1 ring-cyan-300/40 font-semibold"
        >
          {lineText.slice(start, end)}
        </mark>
      );
    }
    cursor = end;
  });

  if (cursor < lineText.length) {
    nodes.push(
      <span key={`${keyPrefix}-tail`}>{lineText.slice(cursor)}</span>
    );
  }
  return nodes;
}

const SUGGESTED_QUERIES = [
  'BroadcastChannel',
  'deduplication',
  'last-writer-wins',
  'merkle',
];

export function SearchModal() {
  const {
    searchOpen,
    searchQuery,
    searchScope,
    searchResults,
    searchStats,
    searchLoading,
    setSearchOpen,
    runSearch,
    openSearchResult,
  } = useWorkspaceStore();

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (searchOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [searchOpen]);

  if (!searchOpen) return null;

  const handleQueryChange = (next: string) => {
    void runSearch(next, searchScope);
  };

  const handleScopeChange = (nextScope: SearchScope) => {
    void runSearch(searchQuery, nextScope);
  };

  return (
    <div
      role="dialog"
      aria-label="Search repository blobs"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-[#050611]/70 backdrop-blur-md"
      onClick={() => setSearchOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-indigo-300/25 bg-[#121530]/92 backdrop-blur-2xl shadow-[0_28px_80px_rgba(4,6,22,0.82)] overflow-hidden flex flex-col max-h-[78vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-indigo-300/15 bg-indigo-950/35">
          <Search className="w-4 h-4 text-cyan-300 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSearchOpen(false);
              }
            }}
            placeholder="Search across all CAS blobs, commit history, and live drafts..."
            aria-label="Full-text search query"
            className="w-full bg-transparent text-sm text-white placeholder:text-indigo-200/55 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => handleQueryChange('')}
              aria-label="Clear search query"
              className="p-1 rounded text-indigo-200 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            className="text-[11px] font-mono text-indigo-200 hover:text-white px-2 py-0.5 rounded border border-indigo-300/25 bg-indigo-500/15 shrink-0"
          >
            ESC
          </button>
        </div>

        {/* Scope Tabs & IndexedDB Stats */}
        <div className="px-4 py-2.5 border-b border-indigo-300/12 bg-indigo-950/20 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div
            role="tablist"
            aria-label="Search scope"
            className="flex items-center p-0.5 rounded-md border border-indigo-300/20 bg-[#0B0D1D]/70"
          >
            <button
              type="button"
              role="tab"
              aria-selected={searchScope === 'all'}
              onClick={() => handleScopeChange('all')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                searchScope === 'all'
                  ? 'bg-gradient-to-r from-cyan-400/25 to-violet-400/25 text-white ring-1 ring-cyan-300/35'
                  : 'text-indigo-200 hover:text-white'
              }`}
            >
              All Blobs (History + Live)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={searchScope === 'working-tree'}
              onClick={() => handleScopeChange('working-tree')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                searchScope === 'working-tree'
                  ? 'bg-gradient-to-r from-cyan-400/25 to-violet-400/25 text-white ring-1 ring-cyan-300/35'
                  : 'text-indigo-200 hover:text-white'
              }`}
            >
              Working Tree Only
            </button>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-indigo-200/85 tabular-nums">
            <Database className="w-3.5 h-3.5 text-violet-300 shrink-0" aria-hidden="true" />
            <span>{searchStats.indexedBlobCount} blobs</span>
            <span aria-hidden="true">·</span>
            <span>{searchStats.tokenCount} tokens in IndexedDB</span>
          </div>
        </div>

        {/* Results Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {!searchQuery.trim() ? (
            <div className="py-8 px-4 text-center space-y-4">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400/20 to-violet-400/25 border border-cyan-300/30 text-cyan-200">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-sm font-semibold text-white">
                  Instant Inverted-Index Blob Search
                </h3>
                <p className="text-xs text-indigo-200/80 max-w-md mx-auto leading-relaxed">
                  Every immutable SHA-256 blob across all commits and branches is
                  tokenized in IndexedDB with prefix matching, camelCase splitting,
                  and BM25 ranking.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {SUGGESTED_QUERIES.map((sample) => (
                  <button
                    key={sample}
                    type="button"
                    onClick={() => handleQueryChange(sample)}
                    className="px-2.5 py-1 text-[11px] font-mono rounded-md border border-indigo-300/20 bg-indigo-500/10 text-cyan-200 hover:bg-cyan-400/20 hover:border-cyan-300/45 transition-colors"
                  >
                    {sample}
                  </button>
                ))}
              </div>
            </div>
          ) : searchLoading ? (
            <div className="py-10 text-center text-xs text-indigo-200">
              Querying IndexedDB inverted index...
            </div>
          ) : searchResults.length === 0 ? (
            <div className="py-10 text-center space-y-1">
              <div className="text-sm font-medium text-white">
                No blobs match &ldquo;{searchQuery}&rdquo;
              </div>
              <div className="text-xs text-indigo-200/75">
                {searchScope === 'working-tree'
                  ? 'Try switching to "All Blobs (History + Live)" to search earlier commits.'
                  : 'Try a shorter prefix or different technical keyword.'}
              </div>
            </div>
          ) : (
            searchResults.map((result) => {
              const primaryOcc = result.occurrences[0];
              const isUncommitted = result.blobHash.startsWith('uncommitted:');
              return (
                <div
                  key={result.blobHash}
                  className="rounded-lg border border-indigo-300/18 bg-indigo-950/35 overflow-hidden hover:border-cyan-300/35 transition-colors"
                >
                  {/* Blob & Occurrences Header */}
                  <div className="px-3.5 py-2.5 border-b border-indigo-300/12 bg-indigo-950/30 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 text-xs">
                      <span className="font-mono text-[11px] text-violet-300 shrink-0 tabular-nums">
                        {isUncommitted
                          ? 'draft'
                          : result.blobHash.slice(0, 8)}
                      </span>
                      <span className="text-indigo-400" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-[11px] font-mono text-indigo-200/80 tabular-nums">
                        score {result.score.toFixed(2)}
                      </span>
                      <span className="text-indigo-400" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-[11px] font-mono text-indigo-200/75 tabular-nums">
                        {result.byteLength} B
                      </span>
                    </div>

                    {primaryOcc && (
                      <button
                        type="button"
                        onClick={() => void openSearchResult(result, primaryOcc)}
                        className="text-[11px] font-medium text-cyan-300 hover:text-cyan-200 transition-colors whitespace-nowrap shrink-0"
                      >
                        {primaryOcc.source === 'working-tree'
                          ? 'Open in Editor →'
                          : 'Inspect Commit →'}
                      </button>
                    )}
                  </div>

                  {/* Occurrence Targets */}
                  <div className="px-3.5 py-2 flex flex-wrap items-center gap-1.5 border-b border-indigo-300/10 bg-[#0B0D1D]/45">
                    {result.occurrences.slice(0, 4).map((occ, oi) => (
                      <button
                        key={`${result.blobHash}-occ-${oi}`}
                        type="button"
                        onClick={() => void openSearchResult(result, occ)}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                          occ.source === 'working-tree'
                            ? 'bg-emerald-400/15 border border-emerald-300/35 text-emerald-200 hover:bg-emerald-400/25'
                            : 'bg-violet-400/15 border border-violet-300/30 text-violet-200 hover:bg-violet-400/25'
                        }`}
                      >
                        {occ.source === 'working-tree' ? (
                          <FileText className="w-3 h-3 shrink-0" />
                        ) : (
                          <GitCommitHorizontal className="w-3 h-3 shrink-0" />
                        )}
                        <span className="truncate max-w-[200px]">{occ.path}</span>
                        <span className="opacity-80">
                          {occ.source === 'working-tree'
                            ? '(Live)'
                            : `(${occ.commitHash?.slice(0, 7)})`}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Snippets */}
                  {result.snippets.length > 0 && (
                    <div className="divide-y divide-indigo-300/10 font-mono text-[11.5px] leading-relaxed bg-[#090B18]/75">
                      {result.snippets.map((snip) => (
                        <button
                          key={`${result.blobHash}-line-${snip.lineNumber}`}
                          type="button"
                          onClick={() =>
                            primaryOcc &&
                            void openSearchResult(result, primaryOcc)
                          }
                          className="w-full px-3.5 py-1.5 text-left flex items-start gap-3 hover:bg-indigo-400/[0.08] transition-colors"
                        >
                          <span className="text-indigo-300/70 select-none w-7 text-right shrink-0 tabular-nums">
                            {snip.lineNumber}
                          </span>
                          <span className="text-slate-100 break-words min-w-0">
                            {renderHighlightedLine(
                              snip.lineText,
                              snip.highlights,
                              `${result.blobHash}-${snip.lineNumber}`
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
