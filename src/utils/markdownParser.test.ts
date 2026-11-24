import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseMarkdown } from './markdownParser';

test('parseMarkdown parses headings, lists, tables, and code fences', () => {
  const md = [
    '# Title',
    '',
    'Hello **world** with `code`.',
    '',
    '| Col A | Col B |',
    '| :--- | :--- |',
    '| 1 | 2 |',
    '',
    '```ts',
    'const x = 1;',
    '```',
  ].join('\n');

  const blocks = parseMarkdown(md);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[1].type, 'paragraph');
  assert.equal(blocks[2].type, 'table');
  assert.equal(blocks[3].type, 'code');
});

test('parseInline blocks unsafe javascript: URLs in markdown links', () => {
  const nodes = parseInline('[click](javascript:alert(1)) and [ok](https://example.com)');
  const links = nodes.filter((n) => n.type === 'link');
  assert.equal(links.length, 1);
  assert.equal(links[0].type === 'link' && links[0].href, 'https://example.com');
});
