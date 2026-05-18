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
  const lines = match[1].split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const raw = kv[2].trim();
    if (raw === "|" || raw === ">") {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1;
        block.push(lines[index].replace(/^\s{1,4}/, ""));
      }
      frontmatter[key] = block.join(raw === ">" ? " " : "\n").trim();
    } else {
      frontmatter[key] = normalizeYamlScalar(raw);
    }
  }
  const body = normalized.slice(match[0].length).trim();
  return { frontmatter, body };
}

export function frontmatterString(
  frontmatter: Record<string, string>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = frontmatter[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function frontmatterBoolean(
  frontmatter: Record<string, string>,
  keys: readonly string[],
  fallback: boolean,
): boolean {
  const raw = frontmatterString(frontmatter, keys);
  if (!raw) return fallback;
  if (/^(true|yes|on|1)$/i.test(raw)) return true;
  if (/^(false|no|off|0)$/i.test(raw)) return false;
  return fallback;
}

function normalizeYamlScalar(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim();
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((item) => normalizeYamlScalar(item.trim()))
      .filter(Boolean)
      .join(" ");
  }
  return value;
}
