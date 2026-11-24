import type { ReactNode } from 'react';
import {
  parseMarkdown,
  type InlineNode,
} from '../utils/markdownParser';

function renderInline(nodes: InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, idx) => {
    const key = `${keyPrefix}-${idx}`;
    switch (node.type) {
      case 'text':
        return <span key={key}>{node.text}</span>;
      case 'strong':
        return (
          <strong key={key} className="font-semibold text-rose-200">
            {renderInline(node.children, key)}
          </strong>
        );
      case 'em':
        return (
          <em key={key} className="italic text-violet-200">
            {renderInline(node.children, key)}
          </em>
        );
      case 'code':
        return (
          <code
            key={key}
            className="font-mono text-[12.5px] px-1.5 py-0.5 rounded bg-violet-500/20 text-emerald-300 border border-violet-400/30"
          >
            {node.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan-300 underline decoration-cyan-400/55 hover:text-cyan-200 hover:decoration-cyan-300 transition-colors"
          >
            {node.label}
          </a>
        );
    }
  });
}

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const blocks = parseMarkdown(content);

  if (blocks.length === 0) {
    return (
      <div className="p-8 text-sm text-indigo-200/70 italic">
        Empty document — start typing in the editor to preview rendered Markdown.
      </div>
    );
  }

  return (
    <article className="px-7 py-6 max-w-3xl space-y-4 text-[14.5px] leading-7 text-slate-200">
      {blocks.map((block, idx) => {
        const key = `blk-${idx}`;
        switch (block.type) {
          case 'heading': {
            if (block.level === 1) {
              return (
                <h1
                  key={key}
                  className="font-display text-2xl font-bold tracking-tight text-white pb-2 border-b border-indigo-300/[0.18]"
                >
                  {renderInline(block.children, key)}
                </h1>
              );
            }
            if (block.level === 2) {
              return (
                <h2
                  key={key}
                  className="font-display text-lg font-semibold tracking-tight text-cyan-200 pt-3"
                >
                  {renderInline(block.children, key)}
                </h2>
              );
            }
            if (block.level === 3) {
              return (
                <h3
                  key={key}
                  className="font-display text-base font-semibold text-violet-200 pt-2"
                >
                  {renderInline(block.children, key)}
                </h3>
              );
            }
            return (
              <h4 key={key} className="font-display text-sm font-semibold text-indigo-100 pt-1">
                {renderInline(block.children, key)}
              </h4>
            );
          }

          case 'paragraph':
            return (
              <p key={key} className="text-slate-200 leading-relaxed">
                {renderInline(block.children, key)}
              </p>
            );

          case 'code':
            return (
              <div
                key={key}
                className="rounded-lg border border-indigo-300/20 glass-surface bg-[#090B19]/85 overflow-x-auto"
              >
                {block.lang && (
                  <div className="px-3.5 py-1.5 border-b border-indigo-300/14 text-[11px] font-mono text-violet-200">
                    {block.lang}
                  </div>
                )}
                <pre className="p-3.5 text-xs font-mono text-emerald-100 leading-6">
                  <code>{block.code}</code>
                </pre>
              </div>
            );

          case 'blockquote':
            return (
              <blockquote
                key={key}
                className="rounded-lg glass-surface border border-violet-300/25 px-4 py-3 text-indigo-100 italic space-y-1"
              >
                {block.lines.map((line, li) => (
                  <p key={`${key}-q-${li}`}>{renderInline(line, `${key}-q-${li}`)}</p>
                ))}
              </blockquote>
            );

          case 'list':
            if (block.ordered) {
              return (
                <ol key={key} className="list-decimal list-outside pl-5 space-y-1.5 text-slate-200 marker:text-violet-300">
                  {block.items.map((item, ii) => (
                    <li key={`${key}-li-${ii}`}>{renderInline(item, `${key}-li-${ii}`)}</li>
                  ))}
                </ol>
              );
            }
            return (
              <ul key={key} className="list-disc list-outside pl-5 space-y-1.5 text-slate-200 marker:text-cyan-300">
                {block.items.map((item, ii) => (
                  <li key={`${key}-li-${ii}`}>{renderInline(item, `${key}-li-${ii}`)}</li>
                ))}
              </ul>
            );

          case 'table':
            return (
              <div key={key} className="overflow-x-auto rounded-lg glass-surface border border-indigo-300/20">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-indigo-500/15 border-b border-indigo-300/20">
                      {block.headers.map((head, hi) => (
                        <th
                          key={`${key}-th-${hi}`}
                          className="px-3.5 py-2.5 font-semibold text-cyan-100"
                        >
                          {renderInline(head, `${key}-th-${hi}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-indigo-300/12 bg-[#090C1C]/60">
                    {block.rows.map((row, ri) => (
                      <tr key={`${key}-tr-${ri}`} className="hover:bg-indigo-400/[0.08]">
                        {row.map((cell, ci) => (
                          <td key={`${key}-td-${ri}-${ci}`} className="px-3.5 py-2 text-slate-200">
                            {renderInline(cell, `${key}-td-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case 'hr':
            return <hr key={key} className="border-indigo-300/20 my-4" />;
        }
      })}
    </article>
  );
}
