import path from "node:path";
import { createHash } from "node:crypto";

export function hashKnowledge(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeKnowledgePath(raw: string): string {
  if (raw.includes("\0")) throw new Error("Paths may not contain NUL bytes.");
  const value = raw.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!value || value.startsWith("/") || /^[A-Za-z]:\//.test(value)) throw new Error("Paths must be relative.");
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Paths may not traverse directories.");
  return parts.join("/");
}

export function resolveKnowledgeTarget(sourcePath: string, rawTarget: string): string | null {
  const clean = rawTarget.split("#", 1)[0].split("?", 1)[0];
  if (!clean) return sourcePath;
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith("//")) return null;
  const relative = clean.startsWith("/") ? clean.slice(1) : path.posix.join(path.posix.dirname(sourcePath), clean);
  try { return normalizeKnowledgePath(relative); } catch { return ""; }
}

export function markdownOutline(body: string): Array<{ depth: number; title: string; anchor: string }> {
  return [...body.matchAll(/^(#{1,6})\s+(.+?)\s*#*$/gm)].map((match) => ({
    depth: match[1].length,
    title: match[2].trim(),
    anchor: headingAnchor(match[2]),
  }));
}

export function headingAnchor(value: string): string {
  return value.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}

export function markdownSection(body: string, section: string): string | null {
  const wanted = headingAnchor(section);
  const lines = body.split("\n");
  let start = -1;
  let depth = 7;
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*#*$/.exec(lines[i]);
    if (!match) continue;
    if (start < 0 && (headingAnchor(match[2]) === wanted || match[2].trim().toLowerCase() === section.toLowerCase())) {
      start = i;
      depth = match[1].length;
      continue;
    }
    if (start >= 0 && match[1].length <= depth) return lines.slice(start, i).join("\n").trim();
  }
  return start >= 0 ? lines.slice(start).join("\n").trim() : null;
}

export function knowledgeChunks(input: {
  title: string; description: string; type: string | null; tags: string[]; body: string;
}): Array<{ key: string; text: string }> {
  const card = [input.title, input.description, input.type ? `type: ${input.type}` : "", input.tags.length ? `tags: ${input.tags.join(", ")}` : ""]
    .filter(Boolean).join("\n");
  const chunks = [{ key: "card", text: card }];
  const blocks = input.body.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  let heading = input.title;
  let buffer = "";
  let index = 0;
  const flush = () => {
    if (!buffer.trim()) return;
    chunks.push({ key: `body:${index++}`, text: `${heading}\n${buffer.trim()}` });
    buffer = "";
  };
  for (const block of blocks) {
    const match = /^(#{1,6})\s+(.+)$/m.exec(block);
    if (match) { flush(); heading = match[2].trim(); }
    if (block.length > 2_000) {
      flush();
      for (let start = 0; start < block.length; start += 2_000) chunks.push({ key: `body:${index++}`, text: `${heading}\n${block.slice(start, start + 2_000)}` });
    } else if (buffer.length + block.length + 2 > 2_000) {
      flush(); buffer = block;
    } else buffer = buffer ? `${buffer}\n\n${block}` : block;
  }
  flush();
  return chunks.filter((item) => item.text.trim());
}

export function extractMarkdownLinks(body: string): Array<{ label: string; target: string; citation: boolean }> {
  const citationsAt = body.search(/^#{1,6}\s+Citations\s*$/im);
  const results: Array<{ label: string; target: string; citation: boolean }> = [];
  for (const match of body.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
    results.push({ label: match[1], target: match[2], citation: citationsAt >= 0 && (match.index ?? 0) > citationsAt });
  }
  return results;
}
