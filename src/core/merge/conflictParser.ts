/**
 * Git-style conflict markers: generation, parsing, and whole-file resolution.
 *
 * Canonical form:
 *
 *   <<<<<<< HEAD
 *   ours…
 *   =======
 *   theirs…
 *   >>>>>>> feat/branch
 */

export type ConflictResolution = "ours" | "theirs" | "both";

export interface ParsedConflict {
  oursLabel: string;
  theirsLabel: string;
  ours: string;
  theirs: string;
}

export class ConflictParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictParseError";
  }
}

const OURS_MARKER = /^<<<<<<<(?: (.*))?$/;
const SEPARATOR_MARKER = /^=======$/;
const THEIRS_MARKER = /^>>>>>>>(?: (.*))?$/;

/** Splits text into lines while preserving each line's trailing newline. */
export function splitLinesWithEndings(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function stripLineEnding(line: string): string {
  return line.replace(/\r?\n$/, "");
}

function sanitizeLabel(label: string): string {
  return label.replace(/[\r\n]+/g, " ").trim() || "branch";
}

function ensureTrailingNewline(text: string): string {
  if (text === "" || text.endsWith("\n")) return text;
  return `${text}\n`;
}

/** Emits an unresolved conflict block with a trailing newline after the marker. */
export function formatConflictBlock(
  ours: string,
  theirs: string,
  oursLabel = "HEAD",
  theirsLabel = "theirs",
): string {
  const oursPart = ensureTrailingNewline(ours);
  const theirsPart = ensureTrailingNewline(theirs);

  return [
    `<<<<<<< ${sanitizeLabel(oursLabel)}\n`,
    oursPart,
    "=======\n",
    theirsPart,
    `>>>>>>> ${sanitizeLabel(theirsLabel)}\n`,
  ].join("");
}

type Segment =
  | { type: "text"; value: string }
  | { type: "conflict"; conflict: ParsedConflict };

function scanSegments(content: string): Segment[] {
  const lines = splitLinesWithEndings(content);
  const segments: Segment[] = [];
  let textBuffer = "";
  let index = 0;

  const flushText = () => {
    if (textBuffer !== "") {
      segments.push({ type: "text", value: textBuffer });
      textBuffer = "";
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;

    const oursMatch = OURS_MARKER.exec(stripLineEnding(line));
    if (!oursMatch) {
      textBuffer += line;
      index += 1;
      continue;
    }

    flushText();
    const oursLabel = oursMatch[1] ?? "";
    index += 1;

    let ours = "";
    while (index < lines.length) {
      const current = lines[index];
      if (current === undefined) break;
      if (SEPARATOR_MARKER.test(stripLineEnding(current))) break;
      ours += current;
      index += 1;
    }

    if (index >= lines.length) {
      throw new ConflictParseError(
        "Unterminated conflict: missing ======= separator",
      );
    }
    index += 1; // consume separator

    let theirs = "";
    while (index < lines.length) {
      const current = lines[index];
      if (current === undefined) break;
      if (THEIRS_MARKER.test(stripLineEnding(current))) break;
      theirs += current;
      index += 1;
    }

    if (index >= lines.length) {
      throw new ConflictParseError(
        "Unterminated conflict: missing >>>>>>> marker",
      );
    }

    const theirsLine = lines[index];
    const theirsMatch = theirsLine
      ? THEIRS_MARKER.exec(stripLineEnding(theirsLine))
      : null;
    index += 1;

    segments.push({
      type: "conflict",
      conflict: {
        oursLabel,
        theirsLabel: theirsMatch?.[1] ?? "",
        ours,
        theirs,
      },
    });
  }

  flushText();
  return segments;
}

/** Parses every conflict block; surrounding text is ignored. */
export function parseConflictHunks(content: string): ParsedConflict[] {
  return scanSegments(content)
    .filter(
      (segment): segment is { type: "conflict"; conflict: ParsedConflict } =>
        segment.type === "conflict",
    )
    .map((segment) => segment.conflict);
}

/** True when content contains an unresolved conflict block opener. */
export function hasConflictMarkers(content: string): boolean {
  return splitLinesWithEndings(content).some((line) =>
    stripLineEnding(line).startsWith("<<<<<<< "),
  );
}

/** Returns the paths (sorted) whose contents still contain conflict markers. */
export function findConflictMarkerPaths(
  files: Readonly<Record<string, string>>,
): string[] {
  return Object.keys(files)
    .filter((path) => {
      const content = files[path];
      return content !== undefined && hasConflictMarkers(content);
    })
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function joinBoth(ours: string, theirs: string): string {
  if (ours === "") return theirs;
  if (theirs === "") return ours;
  return ours.endsWith("\n") ? `${ours}${theirs}` : `${ours}\n${theirs}`;
}

/**
 * Removes all markers, choosing ours, theirs, or both sides for every block.
 * Text outside conflict blocks is preserved byte-for-byte.
 */
export function resolveConflictMarkers(
  content: string,
  resolution: ConflictResolution,
): string {
  let output = "";

  for (const segment of scanSegments(content)) {
    if (segment.type === "text") {
      output += segment.value;
      continue;
    }

    const { ours, theirs } = segment.conflict;
    if (resolution === "ours") output += ours;
    else if (resolution === "theirs") output += theirs;
    else output += joinBoth(ours, theirs);
  }

  return output;
}
