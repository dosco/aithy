import { f, fn, type AxAgentFunction } from "@ax-llm/ax";
import { argsPreview } from "../../security/capability-broker";
import type { KnowledgeConceptInput } from "../../knowledge/types";
import type { ToolContext } from "../tool-context";

export function createKnowledgeTools(ctx: ToolContext): AxAgentFunction[] {
  if (!ctx.knowledge) return [];
  // search/read/list are permission-exempt: bounded, closed-world reads from
  // Aithy's own SQLite database. They cannot touch host state or the network.
  return [
    fn("search")
      .namespace("knowledge")
      .description("Search enabled Knowledge Library bundles before making claims that may be documented there. Returns at most ten compact concept matches with provenance, never full bodies.")
      .arg("query", f.string("Natural-language knowledge query"))
      .arg("bundleId", f.string("Optional bundle UUID").optional())
      .arg("type", f.string("Optional exact concept type").optional())
      .arg("tags", f.string("Optional comma-separated tags that must all match").optional())
      .arg("limit", f.number("Result count; default 5, maximum 10").optional())
      .returnsField("results", f.json("Compact matching concepts with bundle, path, metadata, excerpt, and timestamp"))
      .handler(async ({ query, bundleId, type, tags, limit }) => ({
        results: (await ctx.knowledge!.searchSemantic(query, {
          bundleId: cleanOptional(bundleId), type: cleanOptional(type), tags: splitTags(tags), limit,
        })).map(compactSearchResult),
      }))
      .build(),
    fn("read")
      .namespace("knowledge")
      .description("Read one Knowledge Library concept, optionally just one matching Markdown heading section. Returns provenance, outline, citations, links, backlinks, and at most 32 KiB.")
      .arg("id", f.string("Concept document UUID from knowledge.search or knowledge.list"))
      .arg("section", f.string("Optional heading title or anchor").optional())
      .returnsField("concept", f.json("Bounded concept content and provenance"))
      .handler(({ id, section }) => {
        const concept = ctx.knowledge!.read(id, { section: cleanOptional(section) });
        if (!concept) throw new Error("Knowledge concept or section not found.");
        return { concept: compactRead(concept) };
      })
      .build(),
    fn("list")
      .namespace("knowledge")
      .description("Navigate a knowledge bundle progressively by listing documents under an optional bundle-relative path.")
      .arg("bundleId", f.string("Bundle UUID"))
      .arg("path", f.string("Optional directory path inside the bundle").optional())
      .arg("limit", f.number("Maximum documents; default 50, maximum 100").optional())
      .returnsField("documents", f.json("Bounded document metadata in path order"))
      .handler(({ bundleId, path, limit }) => ({
        documents: boundedDocuments(ctx.knowledge!.list(bundleId, cleanOptional(path) ?? "", limit ?? 50)),
      }))
      .build(),
    fn("propose")
      .namespace("knowledge")
      .description("Draft a create or update to canonical knowledge for human review. This never changes a concept directly and cannot delete knowledge.")
      .arg("bundleId", f.string("Target bundle UUID"))
      .arg("operation", f.string("create or update"))
      .arg("conceptId", f.string("Stable bundle-relative concept ID without .md"))
      .arg("fields", f.json("Complete proposed concept fields: path, type, title, body, and optional description, resource, tags, frontmatter"))
      .arg("rationale", f.string("Why this change improves the library"))
      .arg("evidence", f.string("One or more supporting sources, separated by newlines"))
      .returnsField("proposal", f.json("Review proposal metadata and pending status"))
      .handler(({ bundleId, operation, conceptId, fields, rationale, evidence }) => {
        if (operation !== "create" && operation !== "update") throw new Error("operation must be create or update.");
        const normalized = conceptFields(fields);
        ctx.capabilities?.require({
          conversationId: ctx.session.conversationId,
          capability: "knowledge.propose",
          toolName: "knowledge.propose",
          argsPreview: argsPreview({ bundleId, operation, conceptId, fields: normalized, rationale, evidence }),
        });
        const proposal = ctx.knowledge!.propose({
          bundleId, operation, conceptId, fields: normalized, rationale,
          evidence: evidence.split("\n").map((item) => item.trim()).filter(Boolean),
          sourceSessionId: ctx.session.conversationId,
        });
        ctx.notify?.({
          kind: "knowledge.proposed",
          title: `${operation === "create" ? "New" : "Updated"} knowledge proposed: ${normalized.title}`,
          body: rationale,
          link: `/knowledge?proposal=${proposal.id}`,
          conversationId: ctx.session.conversationId,
        });
        return { proposal: { id: proposal.id, bundleId: proposal.bundleId, operation: proposal.operation,
          conceptId: proposal.conceptId, status: proposal.status, createdAt: proposal.createdAt } };
      })
      .build(),
  ];
}

function compactDocument(document: ReturnType<NonNullable<ToolContext["knowledge"]>["list"]>[number]) {
  return { id: document.id, path: clip(document.path, 500), kind: document.kind, conceptId: clip(document.conceptId, 500),
    type: clip(document.type, 120), title: clip(document.title, 500), description: clip(document.description, 600),
    tags: document.tags.slice(0, 30).map((tag) => clip(tag, 100)), updatedAt: document.updatedAt };
}

function compactSearchResult(result: Awaited<ReturnType<NonNullable<ToolContext["knowledge"]>["searchSemantic"]>>[number]) {
  return { ...result, path: clip(result.path, 500), conceptId: clip(result.conceptId, 500), type: clip(result.type, 120),
    title: clip(result.title, 500), description: clip(result.description, 600), resource: clip(result.resource, 1_000),
    tags: result.tags.slice(0, 30).map((tag) => clip(tag, 100)), excerpt: clip(result.excerpt, 600) };
}

function compactRead(concept: NonNullable<ReturnType<NonNullable<ToolContext["knowledge"]>["read"]>>) {
  const link = (item: { label: string; rawTarget: string; kind: string; sourceTitle?: string; sourcePath?: string }) => ({
    label: clip(item.label, 500), target: clip(item.rawTarget, 1_000), kind: item.kind,
    ...(item.sourceTitle ? { sourceTitle: clip(item.sourceTitle, 500) } : {}),
    ...(item.sourcePath ? { sourcePath: clip(item.sourcePath, 500) } : {}),
  });
  let body = concept.body;
  const value = { id: concept.id, bundleId: concept.bundleId, path: clip(concept.path, 500), conceptId: clip(concept.conceptId, 500),
    type: clip(concept.type, 120), title: clip(concept.title, 500), description: clip(concept.description, 1_000),
    resource: clip(concept.resource, 1_000), tags: concept.tags.slice(0, 30).map((tag) => clip(tag, 100)), updatedAt: concept.updatedAt,
    outline: concept.outline.slice(0, 80).map((item) => ({ ...item, title: clip(item.title, 500), anchor: clip(item.anchor, 500) })),
    citations: concept.citations.slice(0, 50).map(link), links: concept.links.slice(0, 50).map(link),
    backlinks: concept.backlinks.slice(0, 50).map(link), body, truncated: concept.truncated };
  while (jsonBytes(value) > 32_000 && body.length) {
    body = body.slice(0, Math.max(0, body.length - (jsonBytes(value) - 32_000) - 256));
    value.body = body; value.truncated = true;
  }
  return value;
}

function boundedDocuments(documents: ReturnType<NonNullable<ToolContext["knowledge"]>["list"]>) {
  const result: ReturnType<typeof compactDocument>[] = [];
  for (const document of documents) {
    const next = compactDocument(document);
    if (jsonBytes([...result, next]) > 32_000) break;
    result.push(next);
  }
  return result;
}

function clip(value: string | null, length: number): string | null { return value === null ? null : value.slice(0, length); }
function jsonBytes(value: unknown): number { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }

function conceptFields(value: unknown): KnowledgeConceptInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("fields must be an object.");
  const fields = value as Partial<KnowledgeConceptInput>;
  if (typeof fields.path !== "string" || typeof fields.type !== "string" || typeof fields.title !== "string" || typeof fields.body !== "string") {
    throw new Error("fields must include string path, type, title, and body values.");
  }
  return fields as KnowledgeConceptInput;
}

function cleanOptional(value: string | undefined): string | undefined { return value?.trim() || undefined; }
function splitTags(value: string | undefined): string[] | undefined {
  const tags = value?.split(",").map((tag) => tag.trim()).filter(Boolean);
  return tags?.length ? tags : undefined;
}
