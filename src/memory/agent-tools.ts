import { f, fn, type AxAgentFunction } from "@ax-llm/ax";
import type { SqliteMemoryStore } from "./memory-store";
import { MEMORY_KINDS, type MemoryKind } from "./types";

const KIND_DESC = `Memory kind, one of: ${MEMORY_KINDS.join(", ")}.`;

export interface MemoryAgentToolDeps {
  memory: SqliteMemoryStore;
}

export function buildMemoryAgentTools(deps: MemoryAgentToolDeps): AxAgentFunction[] {
  const memory = deps.memory;
  return [
    fn("write")
      .namespace("memory")
      .description("Persist a new memory. Body under ~4 KB (about 500 words). Returns the new id.")
      .arg("kind", f.string(KIND_DESC))
      .arg("title", f.string("Short descriptive label"))
      .arg("body", f.string("The memory content"))
      .arg("tags", f.string("Optional space-separated tags").optional())
      .arg("importance", f.number("0..1, default 0.5").optional())
      .returnsField("id", f.string("New memory id"))
      .handler(({ kind, title, body, tags, importance }) => {
        const entry = memory.upsert({
          kind: assertKind(kind),
          title,
          body,
          tags: tags ?? null,
          importance,
          source: "memory-agent",
        });
        return { id: entry.id };
      })
      .build(),

    fn("supersede")
      .namespace("memory")
      .description("Replace an outdated/incorrect memory with a corrected one.")
      .arg("oldId", f.string("Id being replaced"))
      .arg("kind", f.string(KIND_DESC))
      .arg("title", f.string("Short label"))
      .arg("body", f.string("Corrected body"))
      .arg("tags", f.string("Optional tags").optional())
      .arg("importance", f.number("0..1, default 0.5").optional())
      .returnsField("id", f.string("Id of the replacement"))
      .handler(({ oldId, kind, title, body, tags, importance }) => {
        const entry = memory.supersede(oldId, {
          kind: assertKind(kind),
          title,
          body,
          tags: tags ?? null,
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
