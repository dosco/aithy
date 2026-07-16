import { type ReactNode } from "react";

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-3 [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "heading"; depth: number; text: string }
  | { kind: "code"; lang: string; body: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      blocks.push({ kind: "heading", depth: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: "code", lang, body: body.join("\n") });
      continue;
    }
    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }
    const ulMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (ulMatch) {
      const items: string[] = [ulMatch[1]];
      i += 1;
      while (i < lines.length) {
        const next = lines[i].match(/^\s*[-*]\s+(.*)$/);
        if (!next) break;
        items.push(next[1]);
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }
    const olMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olMatch) {
      const items: string[] = [olMatch[1]];
      i += 1;
      while (i < lines.length) {
        const next = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        if (!next) break;
        items.push(next[1]);
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^```/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "p", lines: para });
  }
  return blocks;
}

function renderBlock(block: Block, index: number): ReactNode {
  if (block.kind === "heading") {
    const Tag = `h${block.depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    return <Tag key={index} className="mt-6 font-semibold leading-tight first:mt-0">{renderInline(block.text)}</Tag>;
  }
  if (block.kind === "code") {
    return (
      <pre
        key={index}
        className="overflow-x-auto rounded-lg bg-[rgb(var(--muted))] px-4 py-3 font-mono text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap"
      >
        <code>{block.body}</code>
      </pre>
    );
  }
  if (block.kind === "ul") {
    return (
      <ul key={index} className="list-disc space-y-1 pl-6 marker:text-[rgb(var(--muted-foreground))]">
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  if (block.kind === "ol") {
    return (
      <ol key={index} className="list-decimal space-y-1 pl-6 marker:text-[rgb(var(--muted-foreground))]">
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ol>
    );
  }
  return (
    <p key={index} className="whitespace-pre-wrap">
      {renderInline(block.lines.join("\n"))}
    </p>
  );
}

function renderInline(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  const pattern = /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|(?<!\*)\*([^*\n]+?)\*(?!\*)|\[([^\]]+)\]\(([^)]+)\)/;
  while (rest.length > 0) {
    const match = rest.match(pattern);
    if (!match || match.index === undefined) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    if (match[2] !== undefined) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-[rgb(var(--muted))] px-[0.35em] py-[0.08em] font-mono text-[0.88em]"
        >
          {match[2]}
        </code>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(<strong key={key++}>{match[3]}</strong>);
    } else if (match[4] !== undefined) {
      nodes.push(<em key={key++}>{match[4]}</em>);
    } else if (match[5] !== undefined && match[6] !== undefined) {
      const href = match[6];
      const safe = /^(https?:|mailto:|\/|#)/i.test(href) ? href : "#";
      nodes.push(
        <a key={key++} href={safe} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">
          {match[5]}
        </a>,
      );
    }
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes;
}
