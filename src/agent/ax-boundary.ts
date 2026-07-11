import type {
  AxAgentCatalogSkill,
  AxAgentFunctionCall,
  AxAgentMemoriesSearchFn,
  AxAgentPlaybookOptions,
  AxFunctionCallTrace,
  AxPlaybook,
  AxPlaybookSnapshot,
} from "@ax-llm/ax";

export type AxServiceHandle = unknown;

export interface AithyAgentProgram {
  forward(
    llm: AxServiceHandle,
    input: unknown,
    options?: unknown,
  ): Promise<{ agentResponse?: unknown }>;
  streamingForward?: (
    llm: AxServiceHandle,
    input: unknown,
    options?: unknown,
  ) => AsyncGenerator<{
    version: number;
    index: number;
    delta: { agentResponse?: unknown };
    partial?: { agentResponse?: unknown };
  }>;
  playbook?: (options?: Readonly<AxAgentPlaybookOptions>) => AxPlaybook<unknown, never>;
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
  directResponse?: "auto" | "off";
  autoUpgrade?: boolean | { functionDiscovery?: boolean; contextFields?: boolean };
  relevanceRanking?: boolean | { topK?: number; minScore?: number };
  skillsCatalog?: readonly AxAgentCatalogSkill[];
  onSkillsSearch?: unknown;
  onLoadedSkills?: unknown;
  onUsedSkills?: unknown;
  onMemoriesSearch?: unknown;
  agentStatusCallback?: (message: string, status: "success" | "failed") => void | Promise<void>;
  onFunctionCall?: (call: AxFunctionCallTrace | AxAgentFunctionCall) => void | Promise<void>;
};

export type { AxAgentMemoriesSearchFn, AxPlaybookSnapshot };
