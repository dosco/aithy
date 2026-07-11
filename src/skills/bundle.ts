import { parseSkillMarkdown, frontmatterBoolean, frontmatterString } from "./frontmatter";
import { parseAuthoredEvals, type SkillEvalDefinition } from "./evals";

export const SKILL_ENTRYPOINT = "SKILL.md";
export const MAX_SKILL_FILE_BYTES = 100_000;
export const MAX_SKILL_BUNDLE_BYTES = 300_000;

export interface SkillFileInput {
  path: string;
  content: string;
}

export interface ParsedSkillBundle {
  id: string;
  name: string;
  description: string;
  whenToUse: string | null;
  body: string;
  allowedTools: string | null;
  tags: string | null;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  files: SkillFileInput[];
  evals: SkillEvalDefinition[];
}

export interface SkillBundleDiff {
  metadataChanged: string[];
  addedFiles: string[];
  removedFiles: string[];
  modifiedFiles: string[];
  skillMarkdownChanged: boolean;
}

export function parseSkillBundleFiles(files: readonly SkillFileInput[]): ParsedSkillBundle {
  if (files.length === 0) throw new Error("Upload at least one file");
  const normalized = files.map((file) => ({
    path: normalizeBundleUploadPath(file.path),
    content: validateTextContent(file.content, file.path),
  }));
  const totalBytes = normalized.reduce((sum, file) => sum + byteLength(file.content), 0);
  if (totalBytes > MAX_SKILL_BUNDLE_BYTES) throw new Error("Skill bundle is too large");

  const entrypoints = normalized.filter((file) => basename(file.path).toLowerCase() === SKILL_ENTRYPOINT.toLowerCase());
  if (entrypoints.length !== 1) throw new Error("A skill bundle must include exactly one SKILL.md");
  const entrypoint = entrypoints[0];
  const root = entrypoint.path.slice(0, entrypoint.path.length - basename(entrypoint.path).length);
  const supporting = normalized
    .filter((file) => file !== entrypoint)
    .map((file) => ({
      path: root && file.path.startsWith(root) ? file.path.slice(root.length) : file.path,
      content: file.content,
    }));
  const { frontmatter, body } = parseSkillMarkdown(entrypoint.content);
  const name = frontmatterString(frontmatter, ["name"]) ?? "";
  const id = slugify(frontmatterString(frontmatter, ["id", "slug"]) ?? name);
  if (!id) throw new Error("SKILL.md must include a name or id");
  return {
    id,
    name: name || id,
    description: frontmatterString(frontmatter, ["description"]) ?? "",
    whenToUse: frontmatterString(frontmatter, ["when_to_use", "when-to-use"]) ?? null,
    body,
    allowedTools: frontmatterString(frontmatter, ["allowed-tools", "allowed_tools", "tools"]),
    tags: frontmatterString(frontmatter, ["tags"]),
    disableModelInvocation: frontmatterBoolean(frontmatter, ["disable-model-invocation", "disable_model_invocation"], false),
    userInvocable: frontmatterBoolean(frontmatter, ["user-invocable", "user_invocable"], true),
    evals: parseAuthoredEvals(frontmatterString(frontmatter, ["evals"]) ?? ""),
    files: normalizeSkillFiles(supporting),
  };
}

export function normalizeSkillFiles(files: readonly SkillFileInput[] | undefined): SkillFileInput[] {
  if (!files?.length) return [];
  const seen = new Set<string>();
  let totalBytes = 0;
  const normalized = files.map((file) => {
    const normalizedPath = normalizeSkillFilePath(file.path);
    if (seen.has(normalizedPath)) throw new Error(`Duplicate skill file path: ${normalizedPath}`);
    seen.add(normalizedPath);
    const content = validateTextContent(file.content, normalizedPath);
    totalBytes += byteLength(content);
    if (totalBytes > MAX_SKILL_BUNDLE_BYTES) throw new Error("Skill supporting files are too large");
    return { path: normalizedPath, content };
  });
  return normalized.sort((a, b) => a.path.localeCompare(b.path));
}

export function normalizeSkillFilePath(raw: string): string {
  const path = normalizeBundleUploadPath(raw);
  if (basename(path).toLowerCase() === SKILL_ENTRYPOINT.toLowerCase()) {
    throw new Error("Supporting files cannot be named SKILL.md");
  }
  return path;
}

export function extractSkillLinks(body: string, files: readonly SkillFileInput[] = []): string[] {
  const links = new Set<string>();
  const scan = [body, ...files.map((file) => file.content)].join("\n");
  for (const match of scan.matchAll(/\]\(\s*skill:([a-z0-9][a-z0-9-]*)\s*\)/gi)) {
    links.add(match[1].toLowerCase());
  }
  return [...links].sort();
}

export function diffSkillBundle(
  existing: {
    name: string;
    description: string;
    when_to_use: string | null;
    allowed_tools: string | null;
    tags: string | null;
    body: string;
    disable_model_invocation: boolean;
    user_invocable: boolean;
    files?: readonly SkillFileInput[];
  } | null,
  next: ParsedSkillBundle,
): SkillBundleDiff {
  if (!existing) {
    return {
      metadataChanged: [],
      addedFiles: next.files.map((file) => file.path),
      removedFiles: [],
      modifiedFiles: [],
      skillMarkdownChanged: true,
    };
  }
  const metadataChanged = [
    changed("name", existing.name, next.name),
    changed("description", existing.description, next.description),
    changed("when_to_use", existing.when_to_use ?? "", next.whenToUse ?? ""),
    changed("allowed_tools", existing.allowed_tools ?? "", next.allowedTools ?? ""),
    changed("tags", existing.tags ?? "", next.tags ?? ""),
    changed("disable_model_invocation", String(existing.disable_model_invocation), String(next.disableModelInvocation)),
    changed("user_invocable", String(existing.user_invocable), String(next.userInvocable)),
    changed("evals", JSON.stringify((existing as { evals?: unknown }).evals ?? []), JSON.stringify(next.evals)),
  ].filter((item): item is string => Boolean(item));
  const before = new Map((existing.files ?? []).map((file) => [file.path, file.content]));
  const after = new Map(next.files.map((file) => [file.path, file.content]));
  return {
    metadataChanged,
    addedFiles: [...after.keys()].filter((path) => !before.has(path)).sort(),
    removedFiles: [...before.keys()].filter((path) => !after.has(path)).sort(),
    modifiedFiles: [...after.keys()].filter((path) => before.has(path) && before.get(path) !== after.get(path)).sort(),
    skillMarkdownChanged: existing.body !== next.body,
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeBundleUploadPath(raw: string): string {
  const path = raw.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "").trim();
  if (!path || path.length > 240) throw new Error(`Invalid skill file path: ${raw}`);
  if (path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe skill file path: ${raw}`);
  }
  return path;
}

function validateTextContent(content: string, label: string): string {
  if (content.includes("\0")) throw new Error(`Skill file appears to be binary: ${label}`);
  if (byteLength(content) > MAX_SKILL_FILE_BYTES) throw new Error(`Skill file is too large: ${label}`);
  return content.replace(/\r\n/g, "\n");
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function changed(label: string, before: string, after: string): string | null {
  return before === after ? null : label;
}
