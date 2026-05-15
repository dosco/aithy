export type SessionNameSource = "generated" | "manual";

export interface TokenUsage {
  input: number;
  output: number;
  thought: number;
  total: number;
}

export interface SessionTokenTotals {
  input: number;
  output: number;
  thought: number;
  total: number;
}

export interface UserMessage {
  role: "user";
  content: string;
  createdAt: string;
}

export interface AssistantTextMessage {
  role: "assistant";
  kind: "text";
  content: string;
  thought?: string;
  runId?: string;
  usage?: TokenUsage;
  createdAt: string;
}

export interface AssistantToolCallMessage {
  role: "assistant";
  kind: "tool_call";
  toolName: string;
  toolArgs: unknown;
  toolResult?: unknown;
  thought?: string;
  usage?: TokenUsage;
  createdAt: string;
}

export type PermissionDecisionStatus = "allowed" | "denied" | "timed_out";

export interface AssistantPermissionMessage {
  role: "assistant";
  kind: "permission";
  requestId: string;
  toolName: string;
  status: PermissionDecisionStatus;
  command: string;
  cwd: string;
  reason: string;
  decidedAt: string;
  createdAt: string;
}

export type AssistantMessage =
  | AssistantTextMessage
  | AssistantToolCallMessage
  | AssistantPermissionMessage;
export type BotMessage = UserMessage | AssistantMessage;

export interface BotSessionSummary {
  conversationId: string;
  name: string;
  nameSource: SessionNameSource;
  source: string;
  model: string | null;
  systemPrompt: string | null;
  parentSessionId: string | null;
  parentMessageId: number | null;
  tokenTotals: SessionTokenTotals;
  createdAt: string;
  updatedAt: string;
  expiresAt: Date;
}

export interface BotSession extends BotSessionSummary {
  sandboxSessionId: string;
  messages: BotMessage[];
  workspacePath: string;
  lastActivityAt: Date;
  state: "live" | "parked";
}
