import type { BotMessage, BotSessionSummary } from "./types";
import type { MessageRow, SessionRow } from "./sqlite-session-schema";

export function summaryFromRow(row: SessionRow): BotSessionSummary {
  return {
    conversationId: row.id,
    name: row.name,
    nameSource: row.name_source,
    source: row.source,
    model: row.model,
    systemPrompt: row.system_prompt,
    parentSessionId: row.parent_session_id,
    parentMessageId: row.parent_message_id,
    tokenTotals: {
      input: row.input_tokens,
      output: row.output_tokens,
      thought: row.thought_tokens,
      total: row.total_tokens,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: new Date(row.expires_at),
  };
}

export function messageRowsToEntries(rows: MessageRow[]): BotMessage[] {
  return rows.map(rowToMessage);
}

function rowToMessage(row: MessageRow): BotMessage {
  const usage = row.total_tokens != null
    ? {
        input: row.input_tokens ?? 0,
        output: row.output_tokens ?? 0,
        thought: row.thought_tokens ?? 0,
        total: row.total_tokens ?? 0,
      }
    : undefined;

  if (row.role === "user") {
    return {
      role: "user",
      content: row.content ?? "",
      createdAt: row.created_at,
    };
  }

  if (row.message_kind === "permission") {
    const metadata = parseMetadata(row.metadata_json);
    return {
      role: "assistant",
      kind: "permission",
      requestId: stringField(metadata, "requestId"),
      toolName: stringField(metadata, "toolName"),
      status: permissionStatusField(metadata),
      command: stringField(metadata, "command"),
      cwd: stringField(metadata, "cwd"),
      reason: stringField(metadata, "reason"),
      decidedAt: stringField(metadata, "decidedAt"),
      createdAt: row.created_at,
    };
  }

  if (row.tool_name !== null || row.tool_args !== null || row.tool_result !== null) {
    const toolArgs = row.tool_args ? JSON.parse(row.tool_args) : null;
    return {
      role: "assistant",
      kind: "tool_call",
      toolName: row.tool_name ?? inferToolName(toolArgs),
      toolArgs,
      toolResult: row.tool_result ? JSON.parse(row.tool_result) : undefined,
      thought: row.thought ?? undefined,
      usage,
      createdAt: row.created_at,
    };
  }

  return {
    role: "assistant",
    kind: "text",
    content: row.content ?? "",
    thought: row.thought ?? undefined,
    ...assistantTextMetadata(row.metadata_json),
    usage,
    createdAt: row.created_at,
  };
}

function inferToolName(toolArgs: unknown): string {
  if (hasKeys(toolArgs, ["query", "task"])) return "web.search";
  if (hasKeys(toolArgs, ["url"])) return "web.fetch";
  if (hasKeys(toolArgs, ["queries", "excludeIds"])) return "memory.recall";
  if (hasKeys(toolArgs, ["queries"])) return "skills.search";
  if (hasKeys(toolArgs, ["command"])) return "sandbox.bash";
  return "unknown";
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  return typeof field === "string" ? field : "";
}

function permissionStatusField(value: Record<string, unknown>) {
  const status = value.status;
  if (status === "allowed" || status === "denied" || status === "timed_out") return status;
  return "denied";
}

function hasKeys(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== "object") return false;
  return keys.every((key) => key in value);
}

export function messageToBindings(message: BotMessage) {
  if (message.role === "user") {
    return {
      $role: "user",
      $messageKind: null,
      $content: message.content,
      $metadataJson: null,
      $thought: null,
      $toolName: null,
      $toolArgs: null,
      $toolResult: null,
      $inputTokens: null,
      $outputTokens: null,
      $thoughtTokens: null,
      $totalTokens: null,
      $createdAt: message.createdAt,
    };
  }

  const usage = message.kind === "permission" ? undefined : message.usage;
  const base = {
    $role: "assistant" as const,
    $messageKind: message.kind,
    $thought: message.kind === "permission" ? null : message.thought ?? null,
    $inputTokens: usage?.input ?? null,
    $outputTokens: usage?.output ?? null,
    $thoughtTokens: usage?.thought ?? null,
    $totalTokens: usage?.total ?? null,
    $createdAt: message.createdAt,
  };

  if (message.kind === "tool_call") {
    return {
      ...base,
      $content: null,
      $metadataJson: null,
      $toolName: message.toolName,
      $toolArgs: JSON.stringify(message.toolArgs ?? null),
      $toolResult:
        message.toolResult === undefined
          ? null
          : JSON.stringify(message.toolResult),
    };
  }

  if (message.kind === "permission") {
    return {
      ...base,
      $content: null,
      $metadataJson: JSON.stringify({
        requestId: message.requestId,
        toolName: message.toolName,
        status: message.status,
        command: message.command,
        cwd: message.cwd,
        reason: message.reason,
        decidedAt: message.decidedAt,
      }),
      $toolName: null,
      $toolArgs: null,
      $toolResult: null,
    };
  }

  return {
    ...base,
    $content: message.content,
    $metadataJson: message.runId ? JSON.stringify({ runId: message.runId }) : null,
    $toolName: null,
    $toolArgs: null,
    $toolResult: null,
  };
}

function assistantTextMetadata(value: string | null): { runId?: string } {
  const metadata = parseMetadata(value);
  const runId = metadata.runId;
  return typeof runId === "string" && runId.length > 0 ? { runId } : {};
}
