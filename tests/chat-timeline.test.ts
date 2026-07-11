import { describe, expect, test } from "bun:test";
import { buildTimeline, type ChatMessageItem } from "../app/components/chat-timeline";
import { deriveWorkingLabel } from "../app/components/chat-working-status";
import type { TaskDto } from "../app/server/dto";
import type { SerializableBotMessage, SerializableSystemPermissionRequest } from "../src/web/live-events";

describe("buildTimeline day dividers", () => {
  test("adds one divider for each day with messages", () => {
    const timeline = buildTestTimeline({
      messages: [
        item("u1", user("hello", "2026-05-01T12:00:00.000Z")),
        item("a1", assistant("hi", "2026-05-01T12:00:01.000Z")),
        item("u2", user("next day", "2026-05-02T12:00:00.000Z")),
      ],
    });

    expect(timeline.filter((entry) => entry.kind === "day-divider").map((entry) => entry.key)).toEqual([
      "day-2026-05-01",
      "day-2026-05-02",
    ]);
  });

  test("does not add a divider for an empty timeline", () => {
    expect(buildTestTimeline()).toEqual([]);
  });

  test("does not add a divider for activity-only days", () => {
    const timeline = buildTestTimeline({
      details: true,
      activities: [{
        type: "activity",
        id: "activity-1",
        conversationId: "session",
        createdAt: "2026-05-01T12:00:00.000Z",
        label: "Working",
      }],
    });

    expect(timeline.map((entry) => entry.kind)).toEqual(["activity"]);
  });

  test("keeps dividers in chronological order with mixed entries", () => {
    const timeline = buildTestTimeline({
      details: true,
      messages: [
        item("u1", user("hello", "2026-05-01T12:00:00.000Z")),
        item("a1", assistant("done", "2026-05-02T12:00:00.000Z")),
      ],
      activities: [{
        type: "activity",
        id: "activity-1",
        conversationId: "session",
        createdAt: "2026-05-01T11:00:00.000Z",
        label: "Starting",
      }],
    });

    expect(timeline.map((entry) => entry.kind)).toEqual([
      "day-divider",
      "activity",
      "user",
      "day-divider",
      "assistant",
    ]);
  });
});

function buildTestTimeline(input: {
  messages?: ChatMessageItem[];
  activities?: Array<{
    type: "activity";
    id: string;
    conversationId: string;
    createdAt: string;
    label: string;
  }>;
  details?: boolean;
} = {}) {
  return buildTimeline({
    messages: input.messages ?? [],
    tasks: [],
    subSessions: [],
    activities: input.activities ?? [],
    permissionRequests: [],
    retryableTasks: [],
    retryingTaskIds: new Set(),
    retryDisabled: false,
    details: input.details ?? false,
    sending: false,
  });
}

describe("working status labels", () => {
  test("pending permissions override every other working status", () => {
    expect(deriveWorkingLabel({
      messages: [item("u1", user("search and edit", "2026-05-01T12:00:00.000Z"))],
      activities: [activity("Searching the web", "2026-05-01T12:00:01.000Z")],
      permissionRequests: [permissionRequest()],
      tasks: [task("running")],
      localTurnPhase: "awaiting_reply",
    })).toEqual({ label: "Waiting for approval" });
  });

  test("paused approval tasks beat recent tool activity", () => {
    expect(deriveWorkingLabel({
      messages: [
        item("u1", user("run it", "2026-05-01T12:00:00.000Z")),
        item("t1", toolCall("sandbox.bash", "2026-05-01T12:00:01.000Z")),
      ],
      activities: [],
      permissionRequests: [],
      tasks: [task("paused_approval")],
      localTurnPhase: "awaiting_reply",
    })).toEqual({ label: "Waiting for approval" });
  });

  test("maps recent tool and activity categories to calm labels", () => {
    const base = {
      permissionRequests: [],
      tasks: [] as TaskDto[],
      localTurnPhase: "awaiting_reply" as const,
    };

    expect(deriveWorkingLabel({
      ...base,
      messages: [
        item("u1", user("look it up", "2026-05-01T12:00:00.000Z")),
        item("t1", toolCall("web.search", "2026-05-01T12:00:01.000Z")),
      ],
      activities: [],
    })).toEqual({ label: "Searching" });
    expect(deriveWorkingLabel({
      ...base,
      messages: [
        item("u1", user("read this", "2026-05-01T12:00:00.000Z")),
        item("t1", toolCall("web.fetch", "2026-05-01T12:00:01.000Z")),
      ],
      activities: [],
    })).toEqual({ label: "Reading" });
    expect(deriveWorkingLabel({
      ...base,
      messages: [
        item("u1", user("fix it", "2026-05-01T12:00:00.000Z")),
        item("t1", toolCall("artifact.write", "2026-05-01T12:00:01.000Z")),
      ],
      activities: [],
    })).toEqual({ label: "Coding" });
    expect(deriveWorkingLabel({
      ...base,
      messages: [item("u1", user("run it", "2026-05-01T12:00:00.000Z"))],
      activities: [activity("$ bun test", "2026-05-01T12:00:01.000Z")],
    })).toEqual({ label: "Running" });
  });

  test("falls back from local submit to thinking", () => {
    expect(deriveWorkingLabel({
      messages: [],
      activities: [],
      permissionRequests: [],
      tasks: [],
      localTurnPhase: "submitting",
    })).toEqual({ label: "Sending" });
    expect(deriveWorkingLabel({
      messages: [],
      activities: [],
      permissionRequests: [],
      tasks: [],
      localTurnPhase: "awaiting_reply",
    })).toEqual({ label: "Thinking" });
  });

  test("keeps a stable label while showing agent-reported detail", () => {
    expect(deriveWorkingLabel({
      messages: [item("u1", user("inspect it", "2026-05-01T12:00:00.000Z"))],
      activities: [{
        ...activity("Finished checking the workspace", "2026-05-01T12:00:01.000Z"),
        detail: {
          kind: "agent-status",
          message: "Finished checking the workspace",
          status: "success",
        },
      }],
      permissionRequests: [],
      tasks: [],
      localTurnPhase: "awaiting_reply",
    })).toEqual({
      label: "Thinking",
      detail: "Finished checking the workspace",
    });
  });
});

function item(id: string, message: SerializableBotMessage): ChatMessageItem {
  return { id, message };
}

function user(content: string, createdAt: string): SerializableBotMessage {
  return { role: "user", content, createdAt };
}

function assistant(content: string, createdAt: string): SerializableBotMessage {
  return { role: "assistant", kind: "text", content, createdAt };
}

function toolCall(toolName: string, createdAt: string): SerializableBotMessage {
  return {
    role: "assistant",
    kind: "tool_call",
    toolName,
    toolArgs: {},
    createdAt,
  };
}

function activity(label: string, createdAt: string) {
  return {
    type: "activity" as const,
    id: `${label}-${createdAt}`,
    conversationId: "session",
    createdAt,
    label,
  };
}

function permissionRequest(): SerializableSystemPermissionRequest {
  return {
    id: "permission-1",
    conversationId: "session",
    toolName: "system.bash",
    capability: "system.bash",
    command: "pwd",
    cwd: "/tmp",
    reason: "inspect files",
    targetKind: null,
    targetValue: null,
    matchOptions: [],
    status: "pending",
    createdAt: "2026-05-01T12:00:01.000Z",
    decidedAt: null,
  };
}

function task(status: TaskDto["status"]): TaskDto {
  return {
    id: `task-${status}`,
    title: "Chat turn",
    kind: "chat.turn",
    status,
    reason: null,
    resultSummary: null,
    errorSummary: null,
    canRetry: false,
    canCancel: status === "planned" || status === "running" || status === "paused_approval",
    conversationId: "session",
    relatedSessionId: "session",
    runtimeCommandId: null,
    queueJobId: null,
    memoryRunId: null,
    skillCandidateId: null,
    permissionRequestId: null,
    retryOfTaskId: null,
    attempt: 1,
    createdAt: "2026-05-01T12:00:00.000Z",
    updatedAt: "2026-05-01T12:00:01.000Z",
    startedAt: null,
    completedAt: null,
  };
}
