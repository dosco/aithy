import { ax, f } from "@ax-llm/ax";
import { createAiService } from "../agent/ai-service";
import type { AppConfig } from "../config/env";
import { buildMemoryAgentTools } from "./agent-tools";
import { formatMemoryForRecall } from "./format";
import type { SqliteMemoryStore } from "./memory-store";

export interface ConsolidatorAgentDeps {
  config: AppConfig;
  memory: SqliteMemoryStore;
}

const signature = f()
  .input(
    "memories",
    f.string(
      "Compact list of every active memory: 'id | kind | importance | title — body'.",
    ),
  )
  .output(
    "summary",
    f.string("One short line describing what you did, or 'nothing to consolidate'."),
  )
  .build();

const description = `You are the memory consolidator. You see the FULL active memory store. Your job is to clean it up.

Look for:
- Exact duplicates — multiple memories asserting the same stable fact with no meaningful new detail. Keep the clearest existing memory and supersede the duplicate rows.
- Direct contradictions — a newer memory plainly contradicts an older memory about the same user/project fact. Supersede only the older row with the newer fact.

Tools:
- memory.write({...}) — write only when replacing exact duplicates requires a clearer canonical sentence.
- memory.supersede({oldId, ...}) — replace one memory with a corrected/merged one.
- memory.delete({id}) — only for exact duplicate rows that should not have a replacement.

Rules:
- Only act when changes are clearly safe. When in doubt, leave the memory alone.
- Never invent new facts. Every write must be derivable from existing memories.
- Do not summarize, generalize, roll up events, prune stale rows, or merge merely related memories.
- The summary field MUST report what you actually did via tool calls. If you called no tools, return "nothing to consolidate".
- This runs unattended; do not call askClarification.`;

export interface ConsolidatorAgent {
  forward(input: { memories: string }): Promise<{ summary: string }>;
  readonly program: unknown;
}

export function createConsolidatorAgent(deps: ConsolidatorAgentDeps): ConsolidatorAgent {
  const llm = createAiService(deps.config);
  const tools = buildMemoryAgentTools({
    config: deps.config,
    memory: deps.memory,
    dedupeWrites: false,
  });
  const program = ax(signature, {
    description,
    functions: tools,
    functionCallMode: "auto",
    maxSteps: 8,
    debug: false,
  } as any);
  return {
    program,
    async forward(input) {
      const result = await program.forward(llm, input);
      return { summary: String(result.summary ?? "nothing to consolidate") };
    },
  };
}

export function formatStoreForConsolidator(rows: readonly {
  id: string; title: string; body: string; kind: string; importance: number;
  validFrom?: string | null; validUntil?: string | null; durationDays?: number | null; frequency?: string | null; evidence?: string | null;
}[]): string {
  if (rows.length === 0) return "(empty store)";
  return rows.map((m) => {
    const meta = [
      m.frequency ? `frequency: ${m.frequency}` : null,
      m.validFrom || m.validUntil ? `valid: ${m.validFrom ?? "unknown"} to ${m.validUntil ?? "unknown"}` : null,
      m.durationDays !== null && m.durationDays !== undefined ? `duration_days: ${m.durationDays}` : null,
      m.evidence ? `evidence: ${m.evidence}` : null,
    ].filter(Boolean).join(" | ");
    return `${m.id} | ${m.kind} | ${m.importance.toFixed(2)} | ${meta} | ${m.title}\n  ${m.body.slice(0, 240).replace(/\n/g, " ")}`;
  }).join("\n\n");
}

export { formatMemoryForRecall };
