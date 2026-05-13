import type { AxAgentFunctionCall, AxFunctionCallTrace } from "@ax-llm/ax";

export type AxServiceHandle = unknown;

export interface AithyAgentProgram {
  forward(
    llm: AxServiceHandle,
    input: unknown,
    options?: unknown,
  ): Promise<{ agentResponse?: unknown }>;
  stop?: () => void;
  getState?: () => unknown;
  setState?: (state: unknown) => unknown;
  getChatLog?: () => unknown;
}

export type AxAgentConfigBoundary = {
  agentIdentity: { name: string; description: string };
  contextFields: Array<{ reverseTruncate: boolean; field: string; keepInPromptChars: number }>;
  contextOptions: { description: string };
  executorOptions: { description: string };
  responderOptions: Record<string, unknown>;
  recursionOptions: Record<string, unknown>;
  functions: unknown[];
  contextPolicy: { preset: string; budget: string };
  runtime: unknown;
  functionDiscovery: boolean;
  onSkillsSearch?: unknown;
  onMemoriesSearch?: unknown;
  onFunctionCall?: (call: AxFunctionCallTrace | AxAgentFunctionCall) => void | Promise<void>;
};
