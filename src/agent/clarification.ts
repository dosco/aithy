import { AxAgentClarificationError } from "@ax-llm/ax";

export function isClarificationPause(error: unknown): error is AxAgentClarificationError {
  return error instanceof AxAgentClarificationError;
}
