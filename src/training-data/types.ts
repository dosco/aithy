import type { AxChatLogEntry, AxChatLogMessage, AxModelUsage, AxProviderMetadata } from "@ax-llm/ax";

export type TrainingTraceStage = "ctx" | "task" | null;
export type TrainingTraceMessage = AxChatLogMessage;

export interface NormalizedTrainingTraceEntry {
  sessionId: string;
  runId: string | null;
  component: string;
  stage: TrainingTraceStage;
  name: string | null;
  model: string;
  axSessionId: string | null;
  remoteId: string | null;
  remoteRequestId: string | null;
  remoteSessionId: string | null;
  providerMetadata: AxProviderMetadata | null;
  modelUsage: AxModelUsage | null;
  messages: TrainingTraceMessage[];
  createdAt: string;
}

export interface TrainingTraceRecord extends NormalizedTrainingTraceEntry {
  id: number;
}

export interface RecordChatLogInput {
  sessionId: string;
  runId?: string | null;
  entries: readonly AxChatLogEntry[];
  createdAt?: string;
}

export interface TrainingPreferencePairInput {
  sessionId: string;
  chosenTraceId?: number | null;
  rejectedTraceId?: number | null;
  promptMessages: TrainingTraceMessage[];
  chosenMessages: TrainingTraceMessage[];
  rejectedMessages: TrainingTraceMessage[];
  source: "feedback" | "regeneration" | "edit";
  createdAt?: string;
}

export interface TrainingDataSummary {
  traceCount: number;
  sftExampleCount: number;
  preferencePairCount: number;
  sessionCount: number;
  earliestAt: string | null;
  latestAt: string | null;
  byComponent: TrainingDataCountRow[];
  byModel: TrainingDataCountRow[];
  bySession: TrainingDataCountRow[];
}

export interface TrainingDataCountRow {
  key: string;
  stage: TrainingTraceStage;
  count: number;
}

