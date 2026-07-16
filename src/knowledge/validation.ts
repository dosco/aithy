import type { KnowledgeConceptInput, KnowledgeJsonValue } from "./types";

const encoder = new TextEncoder();

export function validateKnowledgeConcept(input: KnowledgeConceptInput): void {
  bounded(input.path, "path", 500, true);
  if (input.conceptId !== undefined) bounded(input.conceptId, "conceptId", 500, true);
  bounded(input.type, "type", 300, true);
  bounded(input.title, "title", 500, true);
  if (input.description !== undefined) bounded(input.description, "description", 4_000);
  if (input.resource !== undefined) bounded(input.resource, "resource", 4_000);
  if (typeof input.body !== "string") throw new Error("body must be text.");
  if (encoder.encode(input.body).byteLength > 1_048_576) throw new Error("Knowledge bodies are limited to 1 MiB.");
  if ((input.tags?.length ?? 0) > 100) throw new Error("Knowledge concepts are limited to 100 tags.");
  for (const tag of input.tags ?? []) bounded(tag, "tag", 200, true);
  if (input.frontmatter !== undefined) assertJsonSafe(input.frontmatter);
}

function bounded(value: unknown, field: string, maximum: number, required = false): void {
  if (typeof value !== "string") throw new Error(`${field} must be text.`);
  if (required && !value.trim()) throw new Error(`${field} is required.`);
  if (value.length > maximum) throw new Error(`${field} is limited to ${maximum} characters.`);
}

function assertJsonSafe(value: KnowledgeJsonValue, seen = new Set<unknown>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || seen.has(value)) throw new Error("frontmatter must contain only JSON-safe values.");
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) assertJsonSafe(item, seen);
  seen.delete(value);
}
