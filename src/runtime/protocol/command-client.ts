import type { RuntimeStore } from "../runtime-store";
import type { QueueServiceClient } from "../services/queue/client";
import type {
  CommandCompletion,
  EmbeddingCommand,
  LocalInferenceCommand,
  QueueControlCommand,
  RuntimeServiceRole,
  SandboxCommand,
} from "./types";

type RuntimeCommand = SandboxCommand | EmbeddingCommand | LocalInferenceCommand | QueueControlCommand;
type RuntimeCommandTransport = RuntimeStore | QueueServiceClient;

export interface SendRuntimeCommandOptions {
  timeoutMs?: number;
  pollMs?: number;
}

export async function sendRuntimeCommand<T extends RuntimeCommand>(
  store: RuntimeCommandTransport,
  targetRole: RuntimeServiceRole,
  command: T,
  options: SendRuntimeCommandOptions = {},
): Promise<T["result"]> {
  if ("invokeCommand" in store) {
    return store.invokeCommand<T["result"]>(targetRole, command.kind, command.payload, options.timeoutMs);
  }
  const id = store.enqueueCommand(targetRole, command.kind, command.payload);
  const completion = await store.waitForCommand(id, options);
  if (!completion.ok) throw new RuntimeCommandError(completion.error, { commandId: id, targetRole });
  return completion.result as T["result"];
}

export class RuntimeCommandError extends Error {
  constructor(
    message: string,
    public readonly detail: { commandId: string; targetRole: RuntimeServiceRole },
  ) {
    super(message);
    this.name = "RuntimeCommandError";
  }
}

export function completionResult<T>(result: T): CommandCompletion<T> {
  return { ok: true, result };
}

export function completionError(error: unknown): CommandCompletion<never> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
}
