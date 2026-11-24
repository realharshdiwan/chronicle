export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; label: string; href: string };

export type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'blockquote'; lines: InlineNode[][] }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'table'; headers: InlineNode[][]; rows: InlineNode[][][] }
  | { type: 'hr' };

function isSafeUrl(href: string): boolean {
  const trimmed = href.trim().toLowerCase();
  return (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/')
  );
}

export function parseInline(input: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;
  let buffer = '';

  const flushText = () => {
    if (buffer) {
      nodes.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  while (i < input.length) {
    // Inline code `...`
    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1);
      if (end !== -1) {
        flushText();
        nodes.push({ type: 'code', text: input.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // Bold **...**
    if (input[i] === '*' && input[i + 1] === '*') {
      const end = input.indexOf('**', i + 2);
      if (end !== -1) {
        flushText();
        nodes.push({
          type: 'strong',
          children: parseInline(input.slice(i + 2, end)),
        });
        i = end + 2;
        continue;
      }
    }

    // Italic *...*
    if (input[i] === '*' && input[i + 1] !== '*') {
      const end = input.indexOf('*', i + 1);
      if (end !== -1) {
        flushText();
        nodes.push({
          type: 'em',
          children: parseInline(input.slice(i + 1, end)),
        });
        i = end + 1;
        continue;
      }
    }

    // Link [label](url)
    if (input[i] === '[') {
      const closeBracket = input.indexOf(']', i + 1);
      if (closeBracket !== -1 && input[closeBracket + 1] === '(') {
        const closeParen = input.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          const label = input.slice(i + 1, closeBracket);
          const href = input.slice(closeBracket + 2, closeParen);
          if (isSafeUrl(href)) {
            flushText();
            nodes.push({ type: 'link', label, href });
            i = closeParen + 1;
            continue;
          }
        }
      }
    }

    buffer += input[i];
    i++;
  }

  flushText();
  return nodes;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  const cells = splitTableRow(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

export function parseMarkdown(markdown: string): BlockNode[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block ```
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4;
      blocks.push({ type: 'heading', level, children: parseInline(headingMatch[2]) });
      i++;
      continue;
    }

    // Table (header + separator + rows)
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(line).map((c) => parseInline(c));
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]).map((c) => parseInline(c)));
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: InlineNode[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(parseInline(lines[i].trim().replace(/^>\s?/, '')));
        i++;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    // Unordered or ordered list
    const ulMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    const olMatch = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (ulMatch || olMatch) {
      const ordered = Boolean(olMatch);
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = ordered
          ? /^\d+\.\s+(.+)$/.exec(t)
          : /^[-*]\s+(.+)$/.exec(t);
        if (!m) break;
        items.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph (collect contiguous non-empty, non-block-start lines)
    const paraLines: string[] = [trimmed];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        next.startsWith('#') ||
        next.startsWith('```') ||
        next.startsWith('>') ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(next)
      ) {
        break;
      }
      paraLines.push(next);
      i++;
    }
    blocks.push({
      type: 'paragraph',
      children: parseInline(paraLines.join(' ')),
    });
  }

  return blocks;
}
