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

export type AssistantTextStatus = "completed" | "failed" | "cancelled";

export interface UserMessage {
  role: "user";
  content: string;
  createdAt: string;
}

export interface AssistantTextMessage {
  role: "assistant";
  kind: "text";
  content: string;
  status?: AssistantTextStatus;
  thought?: string;
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

export interface AssistantArtifactMessage {
  role: "assistant";
  kind: "artifact";
  id: string;
  sessionId: string;
  runId: string | null;
  sandboxPath: string;
  relativePath: string;
  title: string;
  description: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  previewKind: "text" | "image" | "download";
  textPreview: string | null;
  openUrl: string;
  downloadUrl: string;
  createdAt: string;
}

export type AssistantMessage =
  | AssistantTextMessage
  | AssistantToolCallMessage
  | AssistantPermissionMessage
  | AssistantArtifactMessage;
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
