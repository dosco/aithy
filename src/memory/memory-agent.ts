import { ax, f } from "@ax-llm/ax";
import { createAiService } from "../agent/ai-service";
import type { AppConfig } from "../config/env";
import { buildMemoryAgentTools } from "./agent-tools";
import { formatMemoryForRecall } from "./format";
import type { SqliteMemoryStore } from "./memory-store";
import { MEMORY_LABELS } from "./types";

export interface MemoryAgentDeps {
  config: AppConfig;
  memory: SqliteMemoryStore;
}

const memoryAgentSignature = f()
  .input("trigger", f.string("'auto' for end-of-turn or 'explicit' when the user asked the main agent to remember something."))
  .input("hint", f.string("If trigger='explicit', the user's request verbatim. Empty otherwise.").optional())
  .input("thread", f.string("The full conversation thread, oldest first, formatted as '[ts] role: content'."))
  .input("memories", f.string("Recent existing durable memories, formatted one per line. Empty if none.").optional())
  .output("summary", f.string("One short line describing what you did, or 'nothing to remember' if you wrote nothing."))
  .build();

const description = `You are the memory triage agent. Given a conversation thread, decide what — if anything — should be persisted to durable memory.

CRITICAL — how to actually persist:
- The ONLY way to save a memory is to \`await memory.write({...})\`. Likewise \`memory.supersede\` and \`memory.delete\` are the only ways to change existing memories.
- The \`summary\` output is a report of what you ACTUALLY did via tool calls. NEVER write a summary like "saved the fact" or "stored the preference" unless you successfully called the corresponding tool earlier in this run. Performative narration is a bug.
- If \`memory.write\` returns \`deduped: true\`, an equivalent memory already existed and no new memory was written.
- If \`memory.write\` returns \`expired: true\`, the candidate was already expired and no memory was written.
- If you call no write/supersede/delete tools, your summary MUST be exactly "nothing to remember" (or a close paraphrase that makes it clear nothing was persisted).
- Tool calls return \`{id}\` (or \`{deleted}\`). If you didn't see that return value, the write didn't happen — say so honestly.

WRITE (\`memory.write\`) only:
- stable facts about the user, their environment, their preferences ("uses pnpm", "main repo is ~/src/foo").
- project-specific conventions or constraints that will matter in future turns.
- something the user explicitly asked you to remember (trigger='explicit').
- time-bounded or episode-like information worth recalling (kind='event', body under ~500 words / 4 KB).

DO NOT WRITE:
- anything derivable from current code or git history.
- transient state for the current conversation.
- speculation; only confirmed facts.
- duplicates — \`memories\` contains recent existing durable memories. If the fact is already present, do not write it again.
- greetings, acknowledgments, pleasantries, and low-signal chat filler.

Prefer \`memory.supersede\` over delete+write when correcting an existing fact.

KIND: 'fact' | 'preference' | 'instruction' | 'event'. Choose exactly one primary kind.
LABELS: choose zero or more controlled retrieval facets: ${MEMORY_LABELS.map((label) => `'${label}'`).join(", ")}. Use topic labels for where the memory is useful, and trait labels like 'deadline', 'recurring', 'time_bound', and 'verbatim_detail' only when the fact actually has that shape. Do not invent labels.
QUALITY: write dense, consolidated, self-contained sentences rather than atomic fragments. Attribute every fact to a named person or "the user"; resolve pronouns. Preserve verbatim details when exact wording matters, such as signs, paintings, book titles, pet behaviors, and similar details. For recurring activities, include an explicit frequency.
TIME-BOUNDED: for travel plans, illness recovery, deadlines, new jobs, and other temporary events, use kind='event' and include validFrom, validUntil, durationDays, and evidence whenever the thread supports them. Dates must be ISO YYYY-MM-DD. validUntil is inclusive; memory.write will skip already-expired candidates and return expired=true.
IMPORTANCE: 0..1, default 0.5; >0.7 only when the user emphasized.

If the thread has nothing memory-worthy: call no tools and return summary "nothing to remember". That is the most common outcome — never invent a fact to justify a write, and never claim a write you didn't perform.

Do NOT call askClarification. This triage runs unattended; there is no user to answer mid-run. Make the best call you can with what's in the thread, or do nothing.`;

export interface MemoryAgent {
  forward(input: {
    trigger: "auto" | "explicit";
    hint?: string;
    thread: string;
    memories?: string;
  }): Promise<{ summary: string }>;
  /** Underlying ax program — exposed for usage capture. */
  readonly program: unknown;
}

export function createMemoryAgent(deps: MemoryAgentDeps): MemoryAgent {
  // Triage runs against the primary model — the small/fast model hallucinates
  // tool calls (writes a confident summary without ever invoking memory.write).
  const llm = createAiService(deps.config);
  const tools = buildMemoryAgentTools({ config: deps.config, memory: deps.memory });
  const program = ax(memoryAgentSignature, {
    description,
    functions: tools,
    functionCallMode: "auto",
    maxSteps: 8,
    debug: false,
  } as any);
  return {
    program,
    async forward(input) {
      const result = await program.forward(llm, {
        ...input,
        memories: input.memories ?? formatRecentMemories(deps.memory),
      });
      return { summary: String(result.summary ?? "nothing to remember") };
    },
  };
}

function formatRecentMemories(memory: SqliteMemoryStore): string {
  return memory.recent(50).map(formatMemoryForRecall).join("\n");
}
