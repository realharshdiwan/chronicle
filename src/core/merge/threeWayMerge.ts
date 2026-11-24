/**
 * Deterministic three-way merge over file maps.
 *
 * Non-overlapping line edits are applied cleanly; overlapping edits produce
 * Git-style conflict markers. File add/add and delete/modify cases are treated
 * as conflicts, matching Git's conservative behaviour.
 */

import { diffArrays } from "diff";

import type { MergeConflictFile } from "../types";
import { formatConflictBlock } from "./conflictParser";

export type MergeFileMap = Readonly<Record<string, string>>;

export interface ThreeWayMergeOptions {
  oursLabel?: string;
  theirsLabel?: string;
}

export interface TextMergeResult {
  content: string;
  hasConflicts: boolean;
  conflictCount: number;
}

export interface ThreeWayMergeResult {
  /** Files that merged without conflict, including unchanged files. */
  resolvedFiles: Record<string, string>;
  conflictFiles: MergeConflictFile[];
  hasConflicts: boolean;
}

interface LineHunk {
  baseStart: number;
  baseEnd: number;
  replacement: string[];
}

interface MergeRegion {
  start: number;
  end: number;
}

/** Splits text into lines while preserving trailing newlines. */
export function splitTextLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

/**
 * Converts a Myers array diff into base-coordinate change hunks. Adjacent
 * removed + added changes collapse into a single replacement hunk.
 */
function computeHunks(
  baseLines: readonly string[],
  sideLines: readonly string[],
): LineHunk[] {
  const changes = diffArrays([...baseLines], [...sideLines]);
  const hunks: LineHunk[] = [];

  let baseIndex = 0;
  let pending: LineHunk | null = null;

  for (const change of changes) {
    if (!change.added && !change.removed) {
      if (pending) {
        pending.baseEnd = baseIndex;
        hunks.push(pending);
        pending = null;
      }
      baseIndex += change.value.length;
      continue;
    }

    if (!pending) {
      pending = { baseStart: baseIndex, baseEnd: baseIndex, replacement: [] };
    }

    if (change.removed) {
      baseIndex += change.value.length;
      pending.baseEnd = baseIndex;
    }

    if (change.added) {
      pending.replacement.push(...change.value);
    }
  }

  if (pending) {
    pending.baseEnd = baseIndex;
    hunks.push(pending);
  }

  return hunks;
}

function compareHunks(left: LineHunk, right: LineHunk): number {
  if (left.baseStart !== right.baseStart) return left.baseStart - right.baseStart;
  return left.baseEnd - right.baseEnd;
}

/**
 * Regions are unions of overlapping hunks from both sides. A pure insertion
 * can be ordered before or after a neighbouring replacement, so only
 * insertions strictly inside a replacement (or two insertions at the exact
 * same base position) are grouped as overlapping.
 */
function rangesTouch(region: MergeRegion, hunk: LineHunk): boolean {
  if (region.start === region.end) {
    // Current region is an insertion at region.start.
    if (hunk.baseStart === hunk.baseEnd) {
      return hunk.baseStart === region.start;
    }
    return hunk.baseStart < region.start && hunk.baseEnd > region.start;
  }

  if (hunk.baseStart === hunk.baseEnd) {
    return hunk.baseStart > region.start && hunk.baseStart < region.end;
  }

  return hunk.baseStart < region.end && hunk.baseEnd > region.start;
}

function buildRegions(hunks: readonly LineHunk[]): MergeRegion[] {
  const sorted = [...hunks].sort(compareHunks);
  const regions: MergeRegion[] = [];

  for (const hunk of sorted) {
    const current = regions[regions.length - 1];
    if (!current) {
      regions.push({ start: hunk.baseStart, end: hunk.baseEnd });
      continue;
    }

    if (rangesTouch(current, hunk)) {
      current.end = Math.max(current.end, hunk.baseEnd);
    } else {
      regions.push({ start: hunk.baseStart, end: hunk.baseEnd });
    }
  }

  return regions;
}

/**
 * Owns a hunk to exactly one region. A zero-length hunk (insertion) at a
 * region boundary is not replayed inside the neighbouring replacement; it is
 * emitted by its own zero-length region instead, so inserts immediately before
 * or after a changed line stay ordered and clean.
 */
function hunkBelongsToRegion(hunk: LineHunk, region: MergeRegion): boolean {
  if (hunk.baseStart < region.start || hunk.baseEnd > region.end) return false;
  if (hunk.baseStart !== hunk.baseEnd) return true;
  if (region.start === region.end) return hunk.baseStart === region.start;
  return hunk.baseStart > region.start && hunk.baseStart < region.end;
}

/**
 * Reconstructs one side's content for a base region by replaying its hunks
 * and carrying over base lines that side did not touch.
 */
function renderRegionSide(
  baseLines: readonly string[],
  hunks: readonly LineHunk[],
  region: MergeRegion,
): string {
  const relevant = hunks
    .filter((hunk) => hunkBelongsToRegion(hunk, region))
    .sort(compareHunks);

  const output: string[] = [];
  let cursor = region.start;

  for (const hunk of relevant) {
    if (hunk.baseStart > cursor) {
      output.push(...baseLines.slice(cursor, hunk.baseStart));
    }
    output.push(...hunk.replacement);
    cursor = Math.max(cursor, hunk.baseEnd);
  }

  if (cursor < region.end) {
    output.push(...baseLines.slice(cursor, region.end));
  }

  return output.join("");
}

/**
 * Line-level three-way merge for one file. Returns content with conflict
 * markers when both sides changed overlapping base regions differently.
 */
export function mergeText3Way(
  baseText: string,
  oursText: string,
  theirsText: string,
  options: ThreeWayMergeOptions = {},
): TextMergeResult {
  const baseLines = splitTextLines(baseText);
  const oursLines = splitTextLines(oursText);
  const theirsLines = splitTextLines(theirsText);

  const oursHunks = computeHunks(baseLines, oursLines);
  const theirsHunks = computeHunks(baseLines, theirsLines);
  const regions = buildRegions([...oursHunks, ...theirsHunks]);

  const oursLabel = options.oursLabel ?? "HEAD";
  const theirsLabel = options.theirsLabel ?? "theirs";

  let output = "";
  let cursor = 0;
  let conflictCount = 0;

  for (const region of regions) {
    output += baseLines.slice(cursor, region.start).join("");

    const baseRegion = baseLines.slice(region.start, region.end).join("");
    const oursRegion = renderRegionSide(baseLines, oursHunks, region);
    const theirsRegion = renderRegionSide(baseLines, theirsHunks, region);

    if (oursRegion === theirsRegion) {
      output += oursRegion;
    } else if (oursRegion === baseRegion) {
      output += theirsRegion;
    } else if (theirsRegion === baseRegion) {
      output += oursRegion;
    } else {
      conflictCount += 1;
      output += formatConflictBlock(
        oursRegion,
        theirsRegion,
        oursLabel,
        theirsLabel,
      );
    }

    cursor = region.end;
  }

  output += baseLines.slice(cursor).join("");

  return {
    content: output,
    hasConflicts: conflictCount > 0,
    conflictCount,
  };
}

/**
 * Three-way merge at file granularity. Every path in the union of the three
 * maps is classified as unchanged, cleanly merged, deleted, or conflicted.
 */
export function threeWayMerge(
  base: MergeFileMap,
  ours: MergeFileMap,
  theirs: MergeFileMap,
  options: ThreeWayMergeOptions = {},
): ThreeWayMergeResult {
  const oursLabel = options.oursLabel ?? "HEAD";
  const theirsLabel = options.theirsLabel ?? "theirs";

  const paths = [
    ...new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]),
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

  const resolvedFiles: Record<string, string> = {};
  const conflictFiles: MergeConflictFile[] = [];

  for (const path of paths) {
    const baseContent = base[path];
    const oursContent = ours[path];
    const theirsContent = theirs[path];

    if (oursContent === undefined && theirsContent === undefined) continue;

    if (
      oursContent !== undefined &&
      theirsContent !== undefined &&
      oursContent === theirsContent
    ) {
      resolvedFiles[path] = oursContent;
      continue;
    }

    if (oursContent === baseContent) {
      // Ours is untouched; take theirs (or propagate our deletion).
      if (theirsContent !== undefined) resolvedFiles[path] = theirsContent;
      continue;
    }

    if (theirsContent === baseContent) {
      // Theirs is untouched; take ours (or propagate their deletion).
      if (oursContent !== undefined) resolvedFiles[path] = oursContent;
      continue;
    }

    if (baseContent === undefined) {
      // Independent additions of the same path with different content.
      const oursAdded = oursContent ?? "";
      const theirsAdded = theirsContent ?? "";
      conflictFiles.push({
        path,
        baseContent: "",
        oursContent: oursAdded,
        theirsContent: theirsAdded,
        mergedWithMarkers: formatConflictBlock(
          oursAdded,
          theirsAdded,
          oursLabel,
          theirsLabel,
        ),
      });
      continue;
    }

    if (oursContent === undefined || theirsContent === undefined) {
      // Delete/modify conflict: the deleted side is represented by "".
      const oursSide = oursContent ?? "";
      const theirsSide = theirsContent ?? "";
      conflictFiles.push({
        path,
        baseContent,
        oursContent: oursSide,
        theirsContent: theirsSide,
        mergedWithMarkers: formatConflictBlock(
          oursSide,
          theirsSide,
          oursLabel,
          theirsLabel,
        ),
      });
      continue;
    }

    const merged = mergeText3Way(baseContent, oursContent, theirsContent, {
      oursLabel,
      theirsLabel,
    });

    if (merged.hasConflicts) {
      conflictFiles.push({
        path,
        baseContent,
        oursContent,
        theirsContent,
        mergedWithMarkers: merged.content,
      });
    } else {
      resolvedFiles[path] = merged.content;
    }
  }

  return {
    resolvedFiles,
    conflictFiles,
    hasConflicts: conflictFiles.length > 0,
  };
}
