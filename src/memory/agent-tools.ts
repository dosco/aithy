import { f, fn, type AxAgentFunction } from "@ax-llm/ax";
import type { AppConfig } from "../config/env";
import { createAiService, createFastAiService } from "../agent/ai-service";
import { createAxDedupeDecider, dedupeExtractedItems } from "../conversation-analysis";
import { assertIsoDate, isExpired, normalizeMemoryTiming } from "./time-bound";
import type { SqliteMemoryStore } from "./memory-store";
import { MEMORY_KINDS, type MemoryEntry, type MemoryKind, type MemoryUpsert } from "./types";

const KIND_DESC = `Memory kind, one of: ${MEMORY_KINDS.join(", ")}.`;
const MEMORY_DEDUPE_LIMIT = 3;
const MEMORY_DEDUPE_CRITERIA = `The candidate is a duplicate only if an existing memory already captures the same stable user/project fact, preference, instruction, relationship, project context, decision, task, goal, event, resource, constraint, vocabulary, or note. Return false when the candidate adds new detail, updates the fact, narrows scope, or differs in a way that should be remembered separately.`;

export interface MemoryAgentToolDeps {
  config: AppConfig;
  memory: SqliteMemoryStore;
  dedupeDecider?: MemoryDedupeDecider;
  dedupeWrites?: boolean;
}

export function buildMemoryAgentTools(deps: MemoryAgentToolDeps): AxAgentFunction[] {
  const memory = deps.memory;
  const dedupeWrites = deps.dedupeWrites ?? true;
  let dedupeDecider = deps.dedupeDecider;
  return [
    fn("write")
      .namespace("memory")
      .description("Persist a new memory. Body under ~4 KB (about 500 words). Searches existing memories first and skips duplicates.")
      .arg("kind", f.string(KIND_DESC))
      .arg("title", f.string("Short descriptive label"))
      .arg("body", f.string("The memory content"))
      .arg("validFrom", f.string("Optional ISO date (YYYY-MM-DD) when this memory starts being true.").optional())
      .arg("validUntil", f.string("Optional ISO date (YYYY-MM-DD) when this memory remains true through.").optional())
      .arg("durationDays", f.number("Optional duration in days; recomputed when validFrom and validUntil are present.").optional())
      .arg("evidence", f.string("Optional short source quote or paraphrase supporting the memory.").optional())
      .arg("frequency", f.string("Optional natural-language recurrence, e.g. 'every weekday morning'.").optional())
      .arg("importance", f.number("0..1, default 0.5").optional())
      .returnsField("id", f.string("New memory id, or existing memory id when deduped"))
      .returnsField("deduped", f.boolean("True when an equivalent memory already existed and no new row was written"))
      .returnsField("expired", f.boolean("True when validUntil is before today and no row was written"))
      .handler(async ({ kind, title, body, validFrom, validUntil, durationDays, evidence, frequency, importance }) => {
        const candidate: MemoryUpsert = {
          kind: assertKind(kind),
          title,
          body,
          validFrom: assertIsoDate(validFrom, "validFrom"),
          validUntil: assertIsoDate(validUntil, "validUntil"),
          durationDays,
          evidence,
          frequency,
          importance,
          source: "memory-agent",
        };
        if (isExpired(candidate.validUntil)) return { id: "", deduped: false, expired: true };
        if (dedupeWrites) {
          dedupeDecider ??= createMemoryDedupeDecider(deps.config);
          return writeDedupedMemory(memory, dedupeDecider, candidate);
        }
        const entry = memory.upsert(candidate);
        return { id: entry.id, deduped: false, expired: false };
      })
      .build(),

    fn("supersede")
      .namespace("memory")
      .description("Replace an outdated/incorrect memory with a corrected one.")
      .arg("oldId", f.string("Id being replaced"))
      .arg("kind", f.string(KIND_DESC))
      .arg("title", f.string("Short label"))
      .arg("body", f.string("Corrected body"))
      .arg("validFrom", f.string("Optional ISO date (YYYY-MM-DD) when this memory starts being true.").optional())
      .arg("validUntil", f.string("Optional ISO date (YYYY-MM-DD) when this memory remains true through.").optional())
      .arg("durationDays", f.number("Optional duration in days; recomputed when validFrom and validUntil are present.").optional())
      .arg("evidence", f.string("Optional short source quote or paraphrase supporting the memory.").optional())
      .arg("frequency", f.string("Optional natural-language recurrence, e.g. 'every weekday morning'.").optional())
      .arg("importance", f.number("0..1, default 0.5").optional())
      .returnsField("id", f.string("Id of the replacement"))
      .handler(({ oldId, kind, title, body, validFrom, validUntil, durationDays, evidence, frequency, importance }) => {
        const entry = memory.supersede(oldId, {
          kind: assertKind(kind),
          title,
          body,
          validFrom: assertIsoDate(validFrom, "validFrom"),
          validUntil: assertIsoDate(validUntil, "validUntil"),
          durationDays,
          evidence,
          frequency,
          importance,
          source: "memory-agent",
        });
        return { id: entry.id };
      })
      .build(),

    fn("delete")
      .namespace("memory")
      .description("Permanently delete a memory. Prefer supersede.")
      .arg("id", f.string("Memory id"))
      .returnsField("deleted", f.boolean("Whether a memory was deleted"))
      .handler(({ id }) => ({ deleted: memory.delete(id) }))
      .build(),
  ];
}

function assertKind(value: string): MemoryKind {
  if ((MEMORY_KINDS as readonly string[]).includes(value)) return value as MemoryKind;
  throw new Error(`Invalid memory kind: ${value}. Expected one of ${MEMORY_KINDS.join(", ")}.`);
}

async function writeDedupedMemory(
  memory: SqliteMemoryStore,
  dedupeDecider: MemoryDedupeDecider,
  candidate: MemoryUpsert,
): Promise<{ id: string; deduped: boolean; expired: boolean }> {
  candidate = { ...candidate, ...normalizeMemoryTiming(candidate) };
  const result = await dedupeExtractedItems([candidate], {
    search: ({ item }) => memory.search(memorySearchQueries(item), {
      kinds: [item.kind],
      limit: MEMORY_DEDUPE_LIMIT,
      markRecalled: false,
    }),
    isDuplicate: ({ item, matches }) => dedupeDecider.isDuplicate(item, matches),
  });

  if (result.newItems.length === 0) {
    return { id: result.duplicates[0]?.matches[0]?.id ?? "", deduped: true, expired: false };
  }

  const entry = memory.upsert(candidate);
  return { id: entry.id, deduped: false, expired: false };
}

function memorySearchQueries(item: MemoryUpsert): string[] {
  return [item.title, item.body]
    .map((part) => part.trim())
    .filter(Boolean);
}

export interface MemoryDedupeDecider {
  isDuplicate(candidate: MemoryUpsert, matches: readonly MemoryEntry[]): Promise<boolean>;
}

function createMemoryDedupeDecider(config: AppConfig): MemoryDedupeDecider {
  const llm = createFastAiService(config) ?? createAiService(config);
  const decider = createAxDedupeDecider<MemoryUpsert, MemoryEntry>(llm);
  return {
    async isDuplicate(candidate, matches) {
      const result = await decider.decide({
        item: candidate,
        matches,
        criteria: MEMORY_DEDUPE_CRITERIA,
        formatItem: formatCandidateMemory,
        formatMatch: formatExistingMemory,
      });
      return result.duplicate;
    },
  };
}

function formatCandidateMemory(item: MemoryUpsert): string {
  return [
    `kind: ${item.kind}`,
    `title: ${item.title}`,
    `body: ${item.body}`,
    item.frequency ? `frequency: ${item.frequency}` : null,
    item.validFrom || item.validUntil ? `valid: ${item.validFrom ?? "unknown"} to ${item.validUntil ?? "unknown"}` : null,
    item.durationDays !== undefined && item.durationDays !== null ? `duration_days: ${item.durationDays}` : null,
    item.evidence ? `evidence: ${item.evidence}` : null,
  ].filter(Boolean).join("\n");
}

function formatExistingMemory(item: MemoryEntry): string {
  return [
    `id: ${item.id}`,
    `kind: ${item.kind}`,
    `title: ${item.title}`,
    `body: ${item.body}`,
    item.frequency ? `frequency: ${item.frequency}` : null,
    item.validFrom || item.validUntil ? `valid: ${item.validFrom ?? "unknown"} to ${item.validUntil ?? "unknown"}` : null,
    item.durationDays !== null ? `duration_days: ${item.durationDays}` : null,
    item.evidence ? `evidence: ${item.evidence}` : null,
  ].filter(Boolean).join("\n");
}
