import { diffArrays } from 'diff';
import { formatConflictBlock } from './conflictParser';

interface BaseEdit {
  start: number; // inclusive index in baseLines
  end: number; // exclusive index in baseLines
  lines: string[];
}

function extractBaseEdits(baseLines: string[], sideLines: string[]): BaseEdit[] {
  const parts = diffArrays(baseLines, sideLines);
  const edits: BaseEdit[] = [];

  let baseIdx = 0;
  let pendingRemoveStart: number | null = null;
  let pendingRemoveCount = 0;
  let pendingAddLines: string[] = [];

  const flushPending = () => {
    if (pendingRemoveStart !== null || pendingAddLines.length > 0) {
      const start = pendingRemoveStart ?? baseIdx;
      edits.push({
        start,
        end: start + pendingRemoveCount,
        lines: pendingAddLines,
      });
      pendingRemoveStart = null;
      pendingRemoveCount = 0;
      pendingAddLines = [];
    }
  };

  for (const part of parts) {
    if (!part.added && !part.removed) {
      flushPending();
      baseIdx += part.value.length;
    } else if (part.removed) {
      if (pendingRemoveStart === null) {
        pendingRemoveStart = baseIdx;
      }
      pendingRemoveCount += part.value.length;
      baseIdx += part.value.length;
    } else if (part.added) {
      if (pendingRemoveStart === null) {
        pendingRemoveStart = baseIdx;
      }
      pendingAddLines.push(...part.value);
    }
  }
  flushPending();

  return edits;
}

function editsOverlap(a: BaseEdit, b: BaseEdit): boolean {
  if (a.start === a.end && b.start === b.end) {
    return a.start === b.start;
  }
  if (a.start === a.end) {
    return a.start >= b.start && a.start <= b.end;
  }
  if (b.start === b.end) {
    return b.start >= a.start && b.start <= a.end;
  }
  return a.start < b.end && b.start < a.end;
}

function reconstructRegion(
  baseLines: string[],
  edits: BaseEdit[],
  clusterStart: number,
  clusterEnd: number
): string[] {
  const out: string[] = [];
  let pos = clusterStart;
  for (const edit of edits) {
    if (edit.start > pos) {
      out.push(...baseLines.slice(pos, edit.start));
    }
    out.push(...edit.lines);
    pos = edit.end;
  }
  if (pos < clusterEnd) {
    out.push(...baseLines.slice(pos, clusterEnd));
  }
  return out;
}

function linesEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function threeWayMergeText(
  baseText: string,
  oursText: string,
  theirsText: string,
  theirsLabel: string
): { content: string; hasConflict: boolean } {
  if (oursText === theirsText) {
    return { content: oursText, hasConflict: false };
  }
  if (oursText === baseText) {
    return { content: theirsText, hasConflict: false };
  }
  if (theirsText === baseText) {
    return { content: oursText, hasConflict: false };
  }

  const baseLines = baseText.split('\n');
  const oursLines = oursText.split('\n');
  const theirsLines = theirsText.split('\n');

  const oursEdits = extractBaseEdits(baseLines, oursLines);
  const theirsEdits = extractBaseEdits(baseLines, theirsLines);

  const output: string[] = [];
  let hasConflict = false;
  let pos = 0;
  let i = 0;
  let j = 0;

  while (i < oursEdits.length || j < theirsEdits.length) {
    const oEdit = i < oursEdits.length ? oursEdits[i] : null;
    const tEdit = j < theirsEdits.length ? theirsEdits[j] : null;

    if (oEdit && (!tEdit || (oEdit.end < tEdit.start && !editsOverlap(oEdit, tEdit)))) {
      if (oEdit.start > pos) {
        output.push(...baseLines.slice(pos, oEdit.start));
      }
      output.push(...oEdit.lines);
      pos = oEdit.end;
      i++;
      continue;
    }

    if (tEdit && (!oEdit || (tEdit.end < oEdit.start && !editsOverlap(oEdit, tEdit)))) {
      if (tEdit.start > pos) {
        output.push(...baseLines.slice(pos, tEdit.start));
      }
      output.push(...tEdit.lines);
      pos = tEdit.end;
      j++;
      continue;
    }

    // Overlapping or co-located edits from both sides: expand conservative cluster
    const clusterOurs: BaseEdit[] = [oursEdits[i++]];
    const clusterTheirs: BaseEdit[] = [theirsEdits[j++]];

    let clusterStart = Math.min(clusterOurs[0].start, clusterTheirs[0].start);
    let clusterEnd = Math.max(clusterOurs[0].end, clusterTheirs[0].end);

    let expanded = true;
    while (expanded) {
      expanded = false;
      while (i < oursEdits.length && oursEdits[i].start <= clusterEnd) {
        clusterEnd = Math.max(clusterEnd, oursEdits[i].end);
        clusterOurs.push(oursEdits[i++]);
        expanded = true;
      }
      while (j < theirsEdits.length && theirsEdits[j].start <= clusterEnd) {
        clusterEnd = Math.max(clusterEnd, theirsEdits[j].end);
        clusterTheirs.push(theirsEdits[j++]);
        expanded = true;
      }
    }

    if (clusterStart > pos) {
      output.push(...baseLines.slice(pos, clusterStart));
    }

    const oursChunk = reconstructRegion(
      baseLines,
      clusterOurs,
      clusterStart,
      clusterEnd
    );
    const theirsChunk = reconstructRegion(
      baseLines,
      clusterTheirs,
      clusterStart,
      clusterEnd
    );

    if (linesEqual(oursChunk, theirsChunk)) {
      output.push(...oursChunk);
    } else {
      hasConflict = true;
      output.push(...formatConflictBlock(oursChunk, theirsChunk, theirsLabel));
    }

    pos = clusterEnd;
  }

  if (pos < baseLines.length) {
    output.push(...baseLines.slice(pos));
  }

  return {
    content: output.join('\n'),
    hasConflict,
  };
}

export function threeWayMergeFiles(
  base: Record<string, string>,
  ours: Record<string, string>,
  theirs: Record<string, string>,
  theirsLabel: string
): {
  mergedFiles: Record<string, string>;
  conflictedFiles: string[];
  clean: boolean;
} {
  const allPaths = Array.from(
    new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])
  ).sort();

  const mergedFiles: Record<string, string> = {};
  const conflictedFiles: string[] = [];

  for (const path of allPaths) {
    const b = base[path];
    const o = ours[path];
    const t = theirs[path];

    // Case 1: Both sides match
    if (o === t) {
      if (o !== undefined) {
        mergedFiles[path] = o;
      }
      continue;
    }

    // Case 2: Only theirs changed
    if (o === b) {
      if (t !== undefined) {
        mergedFiles[path] = t;
      }
      continue;
    }

    // Case 3: Only ours changed
    if (t === b) {
      if (o !== undefined) {
        mergedFiles[path] = o;
      }
      continue;
    }

    // Case 4: Both modified or delete/modify conflict
    if (o !== undefined && t !== undefined) {
      const result = threeWayMergeText(b ?? '', o, t, theirsLabel);
      mergedFiles[path] = result.content;
      if (result.hasConflict) {
        conflictedFiles.push(path);
      }
    } else {
      // Delete / modify conflict
      const oursLines = o !== undefined ? o.split('\n') : ['<deleted in HEAD>'];
      const theirsLines =
        t !== undefined ? t.split('\n') : [`<deleted in ${theirsLabel}>`];
      mergedFiles[path] = formatConflictBlock(
        oursLines,
        theirsLines,
        theirsLabel
      ).join('\n');
      conflictedFiles.push(path);
    }
  }

  return {
    mergedFiles,
    conflictedFiles,
    clean: conflictedFiles.length === 0,
  };
}
