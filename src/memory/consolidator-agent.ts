import { agent, AxJSRuntime, f } from "@ax-llm/ax";
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
- Duplicates — multiple memories asserting the same fact. Pick the best phrasing, supersede the rest.
- Contradictions — newer fact contradicts older. Supersede the older with the newer.
- Fragmented preferences — multiple memories that say nearly the same thing in different words. Merge into one canonical version, supersede the others.
- Episode roll-ups — many similar episodes about a single topic. Combine into one rolled-up episode, supersede the leaves.
- Stale low-value rows — when an old episode-kind memory clearly served its purpose and isn't a stable fact, delete it.

Tools:
- memory.write({...}) — write the canonical version when merging.
- memory.supersede({oldId, ...}) — replace one memory with a corrected/merged one.
- memory.delete({id}) — only when something should no longer exist at all.

Rules:
- Only act when changes are clearly safe. When in doubt, leave the memory alone.
- Never invent new facts. Every write must be derivable from existing memories.
- The summary field MUST report what you actually did via tool calls. If you called no tools, return "nothing to consolidate".
- This runs unattended; do not call askClarification.`;

export interface ConsolidatorAgent {
  forward(input: { memories: string }): Promise<{ summary: string }>;
  readonly program: unknown;
}

export function createConsolidatorAgent(deps: ConsolidatorAgentDeps): ConsolidatorAgent {
  const llm = createAiService(deps.config);
  const tools = buildMemoryAgentTools({ memory: deps.memory });
  const agentConfig: any = {
    agentIdentity: { name: "MemoryConsolidator", description: "Cleans up the memory store." },
    actorOptions: { description },
    functions: tools,
    runtime: new AxJSRuntime(),
    functionDiscovery: false,
    debug: false,
  };
  const program = agent(signature, agentConfig);
  return {
    program,
    async forward(input) {
      const result = await program.forward(llm, input);
      return { summary: String(result.summary ?? "nothing to consolidate") };
    },
  };
}

export function formatStoreForConsolidator(rows: readonly { id: string; title: string; body: string; kind: string; tags: string | null; importance: number }[]): string {
  if (rows.length === 0) return "(empty store)";
  return rows.map((m) => `${m.id} | ${m.kind} | ${m.importance.toFixed(2)} | ${m.title}\n  ${m.body.slice(0, 240).replace(/\n/g, " ")}`).join("\n\n");
}

export { formatMemoryForRecall };
