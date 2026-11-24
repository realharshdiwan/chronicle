import type { ConflictRegion } from '../../types';

export const CONFLICT_START = '<<<<<<< HEAD';
export const CONFLICT_MID = '=======';
export const CONFLICT_END_PREFIX = '>>>>>>> ';

export function hasConflictMarkers(content: string): boolean {
  const lines = content.split('\n');
  let state: 'outside' | 'ours' | 'theirs' = 'outside';
  for (const line of lines) {
    if (state === 'outside' && line.startsWith('<<<<<<< ')) {
      state = 'ours';
    } else if (state === 'ours' && line === CONFLICT_MID) {
      state = 'theirs';
    } else if (state === 'theirs' && line.startsWith(CONFLICT_END_PREFIX)) {
      return true;
    }
  }
  return false;
}

export function parseConflictRegions(content: string): ConflictRegion[] {
  const lines = content.split('\n');
  const regions: ConflictRegion[] = [];

  let i = 0;
  let index = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<< ')) {
      const startLine = i;
      const oursLabel = lines[i].slice('<<<<<<< '.length).trim();
      const oursLines: string[] = [];
      let j = i + 1;

      while (j < lines.length && lines[j] !== CONFLICT_MID) {
        oursLines.push(lines[j]);
        j++;
      }

      if (j < lines.length && lines[j] === CONFLICT_MID) {
        const midLine = j;
        const theirsLines: string[] = [];
        let k = j + 1;

        while (k < lines.length && !lines[k].startsWith(CONFLICT_END_PREFIX)) {
          theirsLines.push(lines[k]);
          k++;
        }

        if (k < lines.length && lines[k].startsWith(CONFLICT_END_PREFIX)) {
          const theirsLabel = lines[k].slice(CONFLICT_END_PREFIX.length).trim();
          regions.push({
            index: index++,
            startLine,
            midLine,
            endLine: k,
            oursLabel,
            theirsLabel,
            oursLines,
            theirsLines,
          });
          i = k + 1;
          continue;
        }
      }
    }
    i++;
  }

  return regions;
}

export function formatConflictBlock(
  oursLines: string[],
  theirsLines: string[],
  theirsLabel: string
): string[] {
  return [
    CONFLICT_START,
    ...oursLines,
    CONFLICT_MID,
    ...theirsLines,
    `${CONFLICT_END_PREFIX}${theirsLabel}`,
  ];
}

export function resolveConflictRegion(
  content: string,
  regionIndex: number,
  choice: 'ours' | 'theirs' | 'both'
): string {
  const regions = parseConflictRegions(content);
  const target = regions.find((r) => r.index === regionIndex);
  if (!target) return content;

  const lines = content.split('\n');
  let replacement: string[];
  if (choice === 'ours') {
    replacement = target.oursLines;
  } else if (choice === 'theirs') {
    replacement = target.theirsLines;
  } else {
    replacement = [...target.oursLines, ...target.theirsLines];
  }

  const nextLines = [
    ...lines.slice(0, target.startLine),
    ...replacement,
    ...lines.slice(target.endLine + 1),
  ];
  return nextLines.join('\n');
}
