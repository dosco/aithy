import { basename } from "node:path";
import type { KnowledgeDocument, KnowledgeJsonValue, OkfFileInput, OkfImportPreview, OkfPreviewDocument } from "./types";
import { hashKnowledge, normalizeKnowledgePath, resolveKnowledgeTarget, extractMarkdownLinks } from "./markdown";

export const OKF_MAX_FILES = 1_000;
export const OKF_MAX_FILE_BYTES = 1_048_576;
export const OKF_MAX_TOTAL_BYTES = 25 * 1_048_576;

export function previewOkfImport(
  inputFiles: readonly OkfFileInput[],
  existing: readonly KnowledgeDocument[] = [],
): OkfImportPreview {
  const normalized = normalizeUpload(inputFiles);
  const files: OkfPreviewDocument[] = [];
  const invalid: Array<{ path: string; error: string }> = [];
  let okfVersion = "0.1";
  for (const file of normalized.files) {
    try {
      const parsed = parseOkfDocument(file.path, file.content);
      files.push(parsed);
      if (file.path === "index.md" && typeof parsed.frontmatter.okf_version === "string") {
        okfVersion = parsed.frontmatter.okf_version;
      }
    } catch (error) {
      invalid.push({ path: file.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  const brokenLinks: Array<{ path: string; target: string }> = [];
  for (const file of files) {
    for (const link of extractMarkdownLinks(file.body)) {
      const target = resolveKnowledgeTarget(file.path, link.target);
      if (target === "" || (target !== null && !byPath.has(target))) brokenLinks.push({ path: file.path, target: link.target });
    }
  }
  const old = new Map(existing.map((file) => [file.path, file.contentHash]));
  const added = files.filter((file) => !old.has(file.path)).map((file) => file.path);
  const changed = files.filter((file) => old.has(file.path) && old.get(file.path) !== file.contentHash).map((file) => file.path);
  const removed = existing.filter((file) => !byPath.has(file.path)).map((file) => file.path);
  const rootIndex = files.find((file) => file.path === "index.md");
  const name = rootIndex?.title || normalized.rootName || "Knowledge bundle";
  return {
    name,
    slug: slugifyKnowledge(normalized.rootName || name),
    description: rootIndex?.description ?? "",
    okfVersion,
    files,
    added,
    changed,
    removed,
    invalid,
    brokenLinks,
    warnings: [
      ...(!rootIndex ? ["The bundle has no root index.md; import is valid but progressive navigation is limited."] : []),
      ...(okfVersion !== "0.1" ? [`OKF ${okfVersion} is not fully understood; importing with best-effort v0.1 semantics.`] : []),
    ],
    importHash: hashKnowledge(files.slice().sort((a, b) => a.path.localeCompare(b.path)).map((f) => `${f.path}\0${f.contentHash}`).join("\0")),
  };
}

export function parseOkfDocument(path: string, content: string): OkfPreviewDocument {
  const reserved = basename(path);
  const kind = reserved === "index.md" ? "index" : reserved === "log.md" ? "log" : "concept";
  const parsed = splitFrontmatter(content);
  if (kind === "concept" && !parsed.hasFrontmatter) throw new Error("Concept documents require YAML frontmatter.");
  if (kind === "log" && parsed.hasFrontmatter) throw new Error("log.md must not contain frontmatter.");
  if (kind === "index" && path !== "index.md" && parsed.hasFrontmatter) throw new Error("Only the bundle-root index.md may contain frontmatter.");
  const frontmatter = parsed.frontmatter;
  const type = stringField(frontmatter.type);
  if (kind === "concept" && !type) throw new Error("Concept frontmatter requires a non-empty type.");
  if (frontmatter.tags !== undefined && (!Array.isArray(frontmatter.tags) || frontmatter.tags.some((tag) => typeof tag !== "string"))) {
    throw new Error("tags must be a YAML list of strings.");
  }
  if (kind === "log") validateLog(parsed.body);
  const conceptId = kind === "concept" ? path.slice(0, -3) : null;
  const title = stringField(frontmatter.title) || titleFromBody(parsed.body) || titleFromPath(path);
  const normalizedFrontmatter = jsonSafe(frontmatter) as Record<string, KnowledgeJsonValue>;
  return {
    path,
    kind,
    conceptId,
    type,
    title,
    description: stringField(frontmatter.description) ?? "",
    resource: stringField(frontmatter.resource),
    tags: (frontmatter.tags as string[] | undefined) ?? [],
    frontmatter: normalizedFrontmatter,
    body: parsed.body,
    contentHash: hashKnowledge(content.replaceAll("\r\n", "\n")),
  };
}

export function renderOkfDocument(document: KnowledgeDocument): string {
  if (document.kind !== "concept") {
    if (document.path === "index.md" && Object.keys(document.frontmatter).length) {
      return `---\n${Bun.YAML.stringify(document.frontmatter, null, 2).trim()}\n---\n${document.body}`;
    }
    return document.body;
  }
  const frontmatter: Record<string, unknown> = {
    ...document.frontmatter,
    type: document.type,
    ...(document.title ? { title: document.title } : {}),
    ...(document.description ? { description: document.description } : {}),
    ...(document.resource ? { resource: document.resource } : {}),
    ...(document.tags.length ? { tags: document.tags } : {}),
    timestamp: document.frontmatter.timestamp ?? document.updatedAt,
  };
  return `---\n${Bun.YAML.stringify(frontmatter, null, 2).trim()}\n---\n${document.body}`;
}

export function synthesizeRootIndex(bundleName: string, documents: readonly KnowledgeDocument[]): string {
  const concepts = documents.filter((doc) => doc.kind === "concept").sort((a, b) => a.path.localeCompare(b.path));
  return [
    "---", 'okf_version: "0.1"', "---", `# ${bundleName}`, "",
    ...concepts.map((doc) => `* [${doc.title}](${doc.path})${doc.description ? ` - ${doc.description}` : ""}`),
    "",
  ].join("\n");
}

function splitFrontmatter(content: string): { hasFrontmatter: boolean; frontmatter: Record<string, unknown>; body: string } {
  const normalized = content.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return { hasFrontmatter: false, frontmatter: {}, body: normalized };
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("YAML frontmatter is missing its closing delimiter.");
  let value: unknown;
  try { value = Bun.YAML.parse(normalized.slice(4, end)); } catch (error) { throw new Error(`Invalid YAML: ${String(error)}`); }
  if (value === null) value = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Frontmatter must be a YAML mapping.");
  return { hasFrontmatter: true, frontmatter: value as Record<string, unknown>, body: normalized.slice(end + 5) };
}

function normalizeUpload(input: readonly OkfFileInput[]): { files: OkfFileInput[]; rootName: string } {
  if (input.length > OKF_MAX_FILES) throw new Error(`OKF imports are limited to ${OKF_MAX_FILES} Markdown files.`);
  const markdown = input.filter((file) => file.path.toLowerCase().endsWith(".md"));
  let total = 0;
  const raw = markdown.map((file) => {
    const bytes = new TextEncoder().encode(file.content).length;
    if (bytes > OKF_MAX_FILE_BYTES) throw new Error(`${file.path} exceeds the 1 MiB file limit.`);
    total += bytes;
    return { path: normalizeKnowledgePath(file.path), content: file.content };
  });
  if (total > OKF_MAX_TOTAL_BYTES) throw new Error("OKF imports are limited to 25 MiB total.");
  if (!raw.length) throw new Error("Select a folder containing Markdown files.");
  const firstSegments = new Set(raw.map((file) => file.path.split("/")[0]));
  const stripRoot = firstSegments.size === 1 && raw.every((file) => file.path.includes("/"));
  const rootName = stripRoot ? raw[0].path.split("/")[0] : "knowledge";
  const seen = new Set<string>();
  const files = raw.map((file) => {
    const path = stripRoot ? file.path.slice(rootName.length + 1) : file.path;
    if (seen.has(path)) throw new Error(`Duplicate path after normalization: ${path}`);
    seen.add(path);
    return { path, content: file.content };
  });
  return { files, rootName };
}

function validateLog(body: string): void {
  for (const match of body.matchAll(/^##\s+(.+)$/gm)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(match[1].trim())) throw new Error("log.md level-two headings must use YYYY-MM-DD dates.");
  }
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function titleFromBody(body: string): string | null { return /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null; }
function titleFromPath(path: string): string {
  const value = basename(path, ".md").replace(/[-_]+/g, " ");
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function jsonSafe(value: unknown, seen = new Set<unknown>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object" || seen.has(value)) throw new Error("Frontmatter must contain only JSON-safe values.");
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = jsonSafe(item, seen);
  seen.delete(value);
  return result;
}

export function slugifyKnowledge(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "knowledge";
}
