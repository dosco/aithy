import type { AssistantClarification, AssistantTextStatus, BotMessage, BotSessionSummary } from "./types";
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

  if (row.message_kind === "artifact") {
    const metadata = parseMetadata(row.metadata_json);
    return {
      role: "assistant",
      kind: "artifact",
      id: stringField(metadata, "id"),
      sessionId: stringField(metadata, "sessionId"),
      runId: nullableStringField(metadata, "runId"),
      sandboxPath: stringField(metadata, "sandboxPath"),
      relativePath: stringField(metadata, "relativePath"),
      title: stringField(metadata, "title"),
      description: nullableStringField(metadata, "description"),
      filename: stringField(metadata, "filename"),
      mimeType: stringField(metadata, "mimeType"),
      sizeBytes: numberField(metadata, "sizeBytes"),
      previewKind: previewKindField(metadata),
      textPreview: nullableStringField(metadata, "textPreview"),
      openUrl: stringField(metadata, "openUrl"),
      downloadUrl: stringField(metadata, "downloadUrl"),
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
    ...textStatus(parseMetadata(row.metadata_json)),
    ...textClarification(parseMetadata(row.metadata_json)),
    thought: row.thought ?? undefined,
    usage,
    createdAt: row.created_at,
  };
}

function textClarification(value: Record<string, unknown>): { clarification?: AssistantClarification } {
  const raw = value.clarification;
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const allowed = new Set(["text", "number", "date", "single_choice", "multiple_choice"]);
  if (typeof record.type !== "string" || !allowed.has(record.type)) return {};
  const choices = Array.isArray(record.choices)
    ? record.choices.flatMap((choice) => {
        if (!choice || typeof choice !== "object") return [];
        const item = choice as Record<string, unknown>;
        return typeof item.label === "string" && typeof item.value === "string"
          ? [{ label: item.label, value: item.value }]
          : [];
      })
    : undefined;
  return {
    clarification: {
      type: record.type as AssistantClarification["type"],
      ...(choices?.length ? { choices } : {}),
    },
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

function nullableStringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function numberField(value: Record<string, unknown>, key: string): number {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : 0;
}

function previewKindField(value: Record<string, unknown>) {
  const field = value.previewKind;
  if (field === "text" || field === "image" || field === "download") return field;
  return "download";
}

function permissionStatusField(value: Record<string, unknown>) {
  const status = value.status;
  if (status === "allowed" || status === "denied" || status === "timed_out") return status;
  return "denied";
}

function textStatus(value: Record<string, unknown>): { status?: AssistantTextStatus } {
  const status = value.status;
  if (status === "completed" || status === "failed" || status === "cancelled") return { status };
  return {};
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

  const usage = message.kind === "permission" || message.kind === "artifact" ? undefined : message.usage;
  const base = {
    $role: "assistant" as const,
    $messageKind: message.kind,
    $thought: message.kind === "text" || message.kind === "tool_call" ? message.thought ?? null : null,
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

  if (message.kind === "artifact") {
    return {
      ...base,
      $content: null,
      $metadataJson: JSON.stringify({
        id: message.id,
        sessionId: message.sessionId,
        runId: message.runId,
        sandboxPath: message.sandboxPath,
        relativePath: message.relativePath,
        title: message.title,
        description: message.description,
        filename: message.filename,
        mimeType: message.mimeType,
        sizeBytes: message.sizeBytes,
        previewKind: message.previewKind,
        textPreview: message.textPreview,
        openUrl: message.openUrl,
        downloadUrl: message.downloadUrl,
      }),
      $toolName: null,
      $toolArgs: null,
      $toolResult: null,
    };
  }

  return {
    ...base,
    $content: message.content,
    $metadataJson: message.status || message.clarification
      ? JSON.stringify({
          ...(message.status ? { status: message.status } : {}),
          ...(message.clarification ? { clarification: message.clarification } : {}),
        })
      : null,
    $toolName: null,
    $toolArgs: null,
    $toolResult: null,
  };
}
