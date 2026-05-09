export interface ParsedSkillMarkdown {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseSkillMarkdown(text: string): ParsedSkillMarkdown {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return { frontmatter: {}, body: normalized.trim() };
  }
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) frontmatter[kv[1]] = kv[2].trim();
  }
  const body = normalized.slice(match[0].length).trim();
  return { frontmatter, body };
}
