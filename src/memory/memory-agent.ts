import { ax, f } from "@ax-llm/ax";
import { createAiService } from "../agent/ai-service";
import type { AppConfig } from "../config/env";
import type { RuntimeStore } from "../runtime/runtime-store";
import { buildMemoryAgentTools } from "./agent-tools";
import { formatMemoryForRecall } from "./format";
import type { SqliteMemoryStore } from "./memory-store";
import { MEMORY_KINDS } from "./types";

export interface MemoryAgentDeps {
  config: AppConfig;
  runtimeStore?: RuntimeStore;
  memory: SqliteMemoryStore;
}

const memoryAgentSignature = f()
  .input("trigger", f.string("'auto' for end-of-turn or 'explicit' when the user asked the main agent to remember something."))
  .input("hint", f.string("If trigger='explicit', the user's request verbatim. Empty otherwise.").optional())
  .input("thread", f.string("A bounded conversation segment, oldest first. Auto runs include '[context #id ts]' overlap lines and '[new #id ts]' fresh lines; explicit runs may include the full session."))
  .input("memories", f.string("Recent existing durable memories, formatted one per line. Empty if none.").optional())
  .output("summary", f.string("One short line describing what you did, or 'nothing to remember' if you wrote nothing."))
  .build();

const description = `You are the memory triage agent. Given a bounded conversation segment, decide what — if anything — should be persisted to durable memory.

CRITICAL — how to actually persist:
- The ONLY way to save a memory is to \`await memory.write({...})\`. Likewise \`memory.supersede\` and \`memory.delete\` are the only ways to change existing memories.
- The \`summary\` output is a report of what you ACTUALLY did via tool calls. NEVER write a summary like "saved the fact" or "stored the preference" unless you successfully called the corresponding tool earlier in this run. Performative narration is a bug.
- If \`memory.write\` returns \`deduped: true\`, an equivalent memory already existed and no new memory was written.
- If \`memory.write\` returns \`expired: true\`, the candidate was already expired and no memory was written.
- If you call no write/supersede/delete tools, your summary MUST be exactly "nothing to remember" (or a close paraphrase that makes it clear nothing was persisted).
- Tool calls return \`{id}\` (or \`{deleted}\`). If you didn't see that return value, the write didn't happen — say so honestly.

WRITE (\`memory.write\`) only:
- stable facts about the user, their environment, their preferences ("uses pnpm", "main repo is ~/src/foo").
- simple explicit personal preferences, including foods, drinks, hobbies, media, tools, and recurring likes/dislikes, when the user states them as true about themselves. Example: "I like coffee, really like it" should write a preference such as "The user really likes coffee."
- tentative interests or possible future preferences when they are specific and useful later. Preserve uncertainty: "I might try cold brew someday" should write "The user is interested in trying cold brew someday", not "The user likes cold brew."
- project-specific conventions or constraints that will matter in future turns.
- something the user explicitly asked you to remember (trigger='explicit').
- dated personal events worth recalling, such as travel plans, deadlines, illness recovery, or new jobs (usually kind='event', body under ~500 words / 4 KB).

DO NOT WRITE:
- anything derivable from current code or git history.
- transient state for the current conversation.
- coding strategy summaries, tool-use lessons, workflow outcomes, failure gotchas, or "what worked last time" notes. Those belong to dream episodes, not semantic memory.
- speculation; only confirmed facts.
- duplicates — \`memories\` contains recent existing durable memories. If the fact is already present, do not write it again.
- context-only overlap in auto runs. Use \`[context ...]\` lines only to understand \`[new ...]\` lines; do not write a memory solely from context that was already processed earlier.
- greetings, acknowledgments, pleasantries, and low-signal chat filler.
- reactions to the current conversation or assistant output ("I like this answer", "that was funny").
- vague tentative references where the durable object is unclear ("I might try that", "maybe someday").

Prefer \`memory.supersede\` over delete+write when correcting an existing fact.

KIND: choose exactly one primary kind from: ${MEMORY_KINDS.map((kind) => `'${kind}'`).join(", ")}.
KIND GUIDANCE:
- 'fact': stable fact not better captured by a more specific kind.
- 'preference': stable or tentative tastes, likes, dislikes, style, and choice tendencies.
- 'instruction': standing user request about future assistant behavior.
- 'relationship': people, roles, and connections.
- 'project_context': durable project/repo/product context.
- 'decision': chosen direction, resolved tradeoff, or accepted rationale.
- 'task': concrete thing to do or follow up on.
- 'goal': desired future state, less concrete than a task.
- 'event': dated plans, bounded trips/deadlines, illness recovery, new jobs, and other temporary events.
- 'resource': file, URL, command, repo, artifact, or pointer.
- 'constraint': user/project boundary or requirement.
- 'vocabulary': local meaning of terms.
- 'note': fallback only when useful but not classifiable.
QUALITY: write dense, consolidated, self-contained sentences rather than atomic fragments. Attribute every fact to a named person or "the user"; resolve pronouns. Preserve verbatim details when exact wording matters, such as signs, paintings, book titles, pet behaviors, and similar details. For recurring activities, include an explicit frequency.
TIME-BOUNDED: for travel plans, illness recovery, deadlines, new jobs, and other temporary events, use kind='event' when no more specific kind fits, and include validFrom, validUntil, durationDays, and evidence whenever the thread supports them. Dates must be ISO YYYY-MM-DD. validUntil is inclusive; memory.write will skip already-expired candidates and return expired=true.
IMPORTANCE: 0..1, default 0.5. Use 0.45-0.6 for simple preferences, 0.6-0.75 for emphasized preferences, 0.3-0.45 for tentative interests, and >0.7 only for critical or strongly emphasized memories.

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
  const llm = createAiService({ config: deps.config, runtimeStore: deps.runtimeStore });
  const tools = buildMemoryAgentTools({
    config: deps.config,
    runtimeStore: deps.runtimeStore,
    memory: deps.memory,
  });
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
