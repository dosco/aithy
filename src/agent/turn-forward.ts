import { AxAgentClarificationError, AxAIServiceAbortedError } from "@ax-llm/ax";
import type { AithyAgentProgram, AxServiceHandle } from "./ax-boundary";
import type { SqliteArtifactStore } from "../artifacts/artifact-store";
import type { AssistantArtifactMessage, AssistantToolCallMessage } from "../session/types";
import { artifactRepairRequest } from "./artifact-intent";
import { artifactMessagesForTurn, type ArtifactRunContext } from "./artifact-turn";

const DELTA_FLUSH_MS = 100;
const DELTA_FLUSH_CHARS = 64;

export interface TurnDelta {
  text: string;
  reset?: boolean;
}

export async function forwardTurn(input: {
  program: AithyAgentProgram;
  llm: AxServiceHandle;
  values: unknown;
  options?: unknown;
  onDelta?: (delta: TurnDelta) => void;
}): Promise<{ agentResponse?: unknown }> {
  const streaming = input.program.streamingForward;
  if (!streaming) return input.program.forward(input.llm, input.values, input.options);

  let response = "";
  let pending = "";
  let version: number | undefined;
  let resetPending = false;
  let sawAgentDelta = false;
  let lastFlushAt = performance.now();
  const flush = () => {
    if (!pending && !resetPending) return;
    input.onDelta?.({ text: pending, ...(resetPending ? { reset: true } : {}) });
    pending = "";
    resetPending = false;
    lastFlushAt = performance.now();
  };

  try {
    for await (const chunk of streaming.call(input.program, input.llm, input.values, input.options)) {
      if (version !== undefined && chunk.version !== version) {
        response = "";
        pending = "";
        resetPending = true;
      }
      version = chunk.version;
      if (chunk.delta.agentResponse === undefined) continue;
      const text = String(chunk.delta.agentResponse);
      sawAgentDelta = true;
      response += text;
      pending += text;
      if (
        resetPending
        || pending.length >= DELTA_FLUSH_CHARS
        || performance.now() - lastFlushAt >= DELTA_FLUSH_MS
      ) flush();
    }
    flush();
    return { agentResponse: response };
  } catch (error) {
    if (isNonFallbackError(error)) throw error;
    if (!sawAgentDelta) return input.program.forward(input.llm, input.values, input.options);
    throw error;
  }
}

function isNonFallbackError(error: unknown): boolean {
  return error instanceof AxAgentClarificationError
    || error instanceof AxAIServiceAbortedError
    || (error instanceof Error && error.name === "AbortError");
}

export async function forwardTurnWithArtifactRepair(input: {
  program: AithyAgentProgram;
  llm: AxServiceHandle;
  values: Record<string, unknown>;
  options?: unknown;
  originalRequest: string;
  requiresArtifact: boolean;
  artifacts?: SqliteArtifactStore;
  sessionId: string;
  run: ArtifactRunContext;
  toolMessages: readonly AssistantToolCallMessage[];
  artifactIdsBeforeTurn: ReadonlySet<string>;
  onDeltaForTurnKey: (turnKey: string) => (delta: TurnDelta) => void;
}): Promise<{ agentResponse: string; artifactMessages: AssistantArtifactMessage[] }> {
  let result = await forwardTurn({
    program: input.program,
    llm: input.llm,
    values: input.values,
    options: input.options,
    onDelta: input.onDeltaForTurnKey(input.run.runId),
  });
  let agentResponse = String(result.agentResponse ?? "");
  let artifactMessages = await collectArtifacts(input);
  if (input.requiresArtifact && artifactMessages.length === 0) {
    result = await forwardTurn({
      program: input.program,
      llm: input.llm,
      values: {
        ...input.values,
        userRequest: artifactRepairRequest(input.originalRequest, input.run.runOutboxPath),
      },
      options: input.options,
      onDelta: input.onDeltaForTurnKey(`${input.run.runId}:repair`),
    });
    agentResponse = String(result.agentResponse ?? "");
    artifactMessages = await collectArtifacts(input);
  }
  if (input.requiresArtifact && artifactMessages.length === 0) {
    agentResponse = "I could not create or publish the requested file in this turn.";
  }
  return { agentResponse, artifactMessages };
}

function collectArtifacts(input: {
  artifacts?: SqliteArtifactStore;
  sessionId: string;
  run: ArtifactRunContext;
  toolMessages: readonly AssistantToolCallMessage[];
  artifactIdsBeforeTurn: ReadonlySet<string>;
}) {
  return artifactMessagesForTurn({
    artifacts: input.artifacts,
    sessionId: input.sessionId,
    run: input.run,
    toolMessages: input.toolMessages,
    artifactIdsBeforeTurn: input.artifactIdsBeforeTurn,
  });
}
