import {
  AxAgentFunction,
  AxJSRuntime,
  agent,
  type AxAgentSkillsSearchFn,
  type AxFunctionCallTrace,
} from "@ax-llm/ax";
import type { AppConfig } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SoulProfile } from "../soul/types";
import { createAiService, createFastAiService } from "./ai-service";
import { aithySignature } from "./signatures";

// Mirror of @ax-llm/ax's AxAgentMemoriesSearchFn (it's exported from the
// runtime but the agent-config typing on `agent()` doesn't currently surface
// it cleanly). The framework passes `alreadyLoaded` so the callback can
// dedupe against memories the agent has already seen this run.
export type AxAgentMemoryResult = { id: string; content: string };
export type AxAgentMemoriesSearchFn = (
  searches: readonly string[],
  alreadyLoaded: readonly AxAgentMemoryResult[],
) =>
  | readonly AxAgentMemoryResult[]
  | Promise<readonly AxAgentMemoryResult[]>;

export interface CreatedAgent {
  program: any;
  llm: any;
}

export type AgentFunctionCallHandler = (
  call: Readonly<AxFunctionCallTrace>,
) => void | Promise<void>;

export interface CreateAithyAgentOptions {
  config: AppConfig;
  tools: AxAgentFunction[];
  events: EventBus;
  conversationId: string;
  soul?: SoulProfile;
  onSkillsSearch?: AxAgentSkillsSearchFn;
  onMemoriesSearch?: AxAgentMemoriesSearchFn;
  onFunctionCall?: AgentFunctionCallHandler;
}

const contextDescription = `conversationHistory is a plain-text transcript of prior turns, one per line, formatted as "[<ISO timestamp>] <role>: <content>". Entries are in chronological order — oldest first, most recent last. The current user turn is delivered separately as userRequest, not inside history.

Resolving referential userRequests:
- Treat conversationHistory as your primary tool for resolving ambiguity. Before answering, always re-read it.
- When userRequest is short, ambiguous, or referential — one-word replies like "yes" / "no" / "do it" / "sure"; pronouns or deictics like "that" / "it" / "them" / "the other one" / "this"; partial answers; or any turn that doesn't make sense in isolation — scan history from most recent to oldest and bind the referent to the most recent open question, choice you offered, or topic under discussion.
- One-word affirmations and negations are direct answers to the most recent question you (the assistant) asked. Act on that answer; do not re-ask the same question.
- If the most recent assistant turn was a clarifying question or offered options, the next user turn almost certainly addresses it. Resolve from there first before considering anything else.
- Only ask the user to clarify when the referent genuinely cannot be resolved from any visible history. When you do ask, briefly quote the candidate interpretations you considered so the user can pick instead of restating from scratch.

When the transcript exceeds its budget, the oldest entries are dropped first, so do not assume the transcript starts at the beginning of the conversation. Durable cross-session memory is available — use it for anything that must survive future truncation, and do not rely on history as durable memory.`;

const durableMemoryDescription = `Durable memory:
- \`inputs.memories\` is auto-populated with relevant prior facts and preferences. Read it before answering questions that might depend on user/project context not in the current conversation.
- Call \`recall([...])\` with extra topic queries when you need more than what's already loaded — additional matches accumulate into \`inputs.memories\`.
- The memory triage agent runs after each of your turns. You do NOT decide what to persist. Use \`memory.remember(hint)\` ONLY when the user explicitly asks you to remember something ("remember that…", "save this…"); it queues the request for triage. The user does not need to be told a queue exists — just acknowledge naturally.

Keep your prompt focused on the user's request; do not narrate memory decisions.`;

const microsandboxActorDescription = `You drive a Linux microVM rooted at /workspace. /workspace is the bot's shared workspace — every conversation with this bot sees the same files here, and anything you write lands on the user's host machine under ~/.config/aithy/<botId>/workspace/. Files persist across conversations and across VM restarts. Use the sandbox tools to do real work; do not paraphrase or simulate commands you could actually run.

Mounting policy: host paths outside /workspace (e.g. /Users/..., /home/...) are only visible after a mount. Use sandbox.mount to expose them. The VM restarts on a folder mount, so do this BEFORE any command that uses the file. Mounting a file copies it (copy-on-write where supported) into /workspace/<filename>; mounting a folder bind-mounts it at /mounts/<name>.

Sandbox filesystem topology (this VM ⇄ the host):
  /workspace        ⇄  ~/.config/aithy/<botId>/workspace/   (bot-shared, persistent)
  /mounts/<name>    ⇄  user-selected host folder            (read-write bind mount, top-level)

Cross-conversation pollution is normal: if conversation A wrote /workspace/report.csv, conversation B sees the same file. Treat /workspace like a real shared workstation filesystem — namespace your scratch files when collisions matter.

${durableMemoryDescription}`;

const disabledActorDescription = `Sandboxing is disabled. Shell commands run locally on the host through Bun Shell, rooted at the bot's shared workspace directory at ~/.config/aithy/<botId>/workspace/. Use the sandbox tools to do real work; do not paraphrase or simulate commands you could actually run.

Filesystem topology:
  /workspace  ⇄  ~/.config/aithy/<botId>/workspace/   (bot-shared, persistent)

Cross-conversation pollution is normal — every conversation with this bot sees the same /workspace files, and they survive across restarts.

No tool is available to expose arbitrary host paths in this mode. Work with files already in /workspace, or ask the user to place files there.

${durableMemoryDescription}`;

export function actorDescriptionForSandbox(config: AppConfig): string {
  return config.sandboxProvider === "disabled"
    ? disabledActorDescription
    : microsandboxActorDescription;
}

export function createAithyAgent({
  config,
  tools,
  events,
  conversationId,
  soul,
  onSkillsSearch,
  onMemoriesSearch,
  onFunctionCall,
}: CreateAithyAgentOptions): CreatedAgent {
  const llm = createAiService(config);
  const fastLlm = createFastAiService(config);

  const responderOptions: Record<string, unknown> = {
    description: soul?.responderDescription,
  };
  if (fastLlm) responderOptions.ai = fastLlm;

  const recursionOptions: Record<string, unknown> = {};
  if (fastLlm) recursionOptions.ai = fastLlm;

  const agentConfig: any = {
    agentIdentity: {
      name: soul?.name ?? "Aithy",
      description: soul?.description ?? "Friendly neighborhood bot",
    },
    contextFields: [
      {
        reverseTruncate: true,
        field: "conversationHistory",
        keepInPromptChars: 500,
      },
    ],
    contextOptions: { description: contextDescription },
    actorOptions: { description: actorDescriptionForSandbox(config) },
    responderOptions,
    recursionOptions,
    functions: tools,
    contextPolicy: { preset: "checkpointed", budget: "balanced" },
    runtime: new AxJSRuntime(),
    functionDiscovery: false,
    onSkillsSearch,
    onMemoriesSearch,
    onFunctionCall: onFunctionCall ? (call: unknown) => onFunctionCall(call as AxFunctionCallTrace) : undefined,
    debug: true,
  };
  const program = agent(aithySignature, agentConfig);

  return { program, llm };
}
