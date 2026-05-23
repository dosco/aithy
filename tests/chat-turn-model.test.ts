import { describe, expect, test } from "bun:test";
import {
  deriveChatTurn,
  IDLE_LOCAL_CHAT_TURN,
  shouldDrainPending,
  type ChatTurn,
} from "../app/components/chat-turn-model";
import type { ChatMessageItem } from "../app/components/chat-timeline";
import type { TaskDto } from "../app/server/dto";
import type { SerializableBotMessage } from "../src/web/live-events";

const sessionId = "session-a";

describe("chat turn model", () => {
  test("active chat task makes the latest user turn busy before assistant reply", () => {
    const turn = deriveChatTurn({
      sessionId,
      messages: [item(user("hello", "2026-05-17T10:00:00.000Z"))],
      tasks: [task({ status: "running" })],
      localTurn: IDLE_LOCAL_CHAT_TURN,
    });

    expect(turn.busy).toBe(true);
    expect(turn.status).toBe("busy");
    expect(turn.activeTask?.id).toBe("task-1");
  });

  test("assistant text after latest user clears busy despite stale running task", () => {
    const turn = deriveChatTurn({
      sessionId,
      messages: [
        item(user("hello", "2026-05-17T10:00:00.000Z")),
        item(assistant("hi", "2026-05-17T10:00:01.000Z")),
      ],
      tasks: [task({ status: "running" })],
      localTurn: IDLE_LOCAL_CHAT_TURN,
    });

    expect(turn.busy).toBe(false);
    expect(turn.status).toBe("success");
    expect(turn.activeTask).toBeNull();
  });

  test("old assistant text does not clear a newer user turn", () => {
    const turn = deriveChatTurn({
      sessionId,
      messages: [
        item(user("first", "2026-05-17T10:00:00.000Z")),
        item(assistant("first reply", "2026-05-17T10:00:01.000Z")),
        item(user("second", "2026-05-17T10:00:02.000Z")),
      ],
      tasks: [task({ status: "running", updatedAt: "2026-05-17T10:00:03.000Z" })],
      localTurn: IDLE_LOCAL_CHAT_TURN,
    });

    expect(turn.busy).toBe(true);
    expect(turn.terminalAssistant).toBeNull();
  });

  test("tool and artifact messages do not end a turn", () => {
    const turn = deriveChatTurn({
      sessionId,
      messages: [
        item(user("make a file", "2026-05-17T10:00:00.000Z")),
        item(toolCall("2026-05-17T10:00:01.000Z")),
        item(artifact("2026-05-17T10:00:02.000Z")),
      ],
      tasks: [task({ status: "running" })],
      localTurn: IDLE_LOCAL_CHAT_TURN,
    });

    expect(turn.busy).toBe(true);
    expect(turn.terminalAssistant).toBeNull();
  });

  test("success drains after a reply becomes visible", () => {
    const previous = deriveChatTurn({
      sessionId,
      messages: [item(user("hello", "2026-05-17T10:00:00.000Z"))],
      tasks: [task({ status: "running" })],
      localTurn: IDLE_LOCAL_CHAT_TURN,
    });
    const current = deriveChatTurn({
      sessionId,
      messages: [
        item(user("hello", "2026-05-17T10:00:00.000Z")),
        item(assistant("done", "2026-05-17T10:00:02.000Z")),
      ],
      tasks: [task({ status: "running", updatedAt: "2026-05-17T10:00:03.000Z" })],
      localTurn: IDLE_LOCAL_CHAT_TURN,
    });

    expect(shouldDrainPending({ previous, current })).toBe(true);
  });

  test("success does not drain across session or latest-user changes", () => {
    const previous = busyTurn();
    const otherSession = deriveChatTurn({
      sessionId: "session-b",
      messages: [
        item(user("hello", "2026-05-17T10:00:00.000Z")),
        item(assistant("done", "2026-05-17T10:00:01.000Z")),
      ],
      tasks: [],
      localTurn: IDLE_LOCAL_CHAT_TURN,
    });
    const otherUserTurn = deriveChatTurn({
      sessionId,
      messages: [
        item(user("new", "2026-05-17T10:00:02.000Z")),
        item(assistant("done", "2026-05-17T10:00:03.000Z")),
      ],
      tasks: [],
      localTurn: IDLE_LOCAL_CHAT_TURN,
    });

    expect(shouldDrainPending({ previous, current: otherSession })).toBe(false);
    expect(shouldDrainPending({ previous, current: otherUserTurn })).toBe(false);
  });

  test("stop, error, failed task, and cancelled task do not drain", () => {
    const previous = busyTurn();
    const cases: ChatTurn[] = [
      repliedTurn("[stopped]"),
      repliedTurn("Error: model failed"),
      repliedTurn("model failed", "failed"),
      deriveChatTurn({
        sessionId,
        messages: [item(user("hello", "2026-05-17T10:00:00.000Z"))],
        tasks: [task({ status: "failed" })],
        localTurn: IDLE_LOCAL_CHAT_TURN,
      }),
      deriveChatTurn({
        sessionId,
        messages: [item(user("hello", "2026-05-17T10:00:00.000Z"))],
        tasks: [task({ status: "cancelled" })],
        localTurn: IDLE_LOCAL_CHAT_TURN,
      }),
    ];

    expect(cases.map((current) => shouldDrainPending({ previous, current }))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("permission denial and slash-command replies do not drain pending chat", () => {
    const previous = busyTurn();
    const commandPrevious = deriveChatTurn({
      sessionId,
      messages: [item(user("still working", "2026-05-17T10:00:00.000Z"))],
      tasks: [task({ status: "running" })],
      localTurn: {
        conversationId: sessionId,
        userCreatedAt: null,
        taskId: null,
        phase: "submitting",
      },
    });
    const denied = deriveChatTurn({
      sessionId,
      messages: [
        item(user("run it", "2026-05-17T10:00:00.000Z")),
        item(permission("denied", "2026-05-17T10:00:01.000Z")),
      ],
      tasks: [task({ status: "running" })],
      localTurn: IDLE_LOCAL_CHAT_TURN,
    });
    const commandReply = deriveChatTurn({
      sessionId,
      messages: [
        item(user("still working", "2026-05-17T10:00:00.000Z")),
        item(assistant("Available commands", "2026-05-17T10:00:01.000Z")),
      ],
      tasks: [],
      localTurn: IDLE_LOCAL_CHAT_TURN,
    });

    expect(shouldDrainPending({ previous, current: denied })).toBe(false);
    expect(shouldDrainPending({ previous: commandPrevious, current: commandReply })).toBe(false);
  });
});

function busyTurn(): ChatTurn {
  return deriveChatTurn({
    sessionId,
    messages: [item(user("hello", "2026-05-17T10:00:00.000Z"))],
    tasks: [task({ status: "running" })],
    localTurn: IDLE_LOCAL_CHAT_TURN,
  });
}

function repliedTurn(
  content: string,
  status?: Extract<SerializableBotMessage, { role: "assistant"; kind: "text" }>["status"],
): ChatTurn {
  return deriveChatTurn({
    sessionId,
    messages: [
      item(user("hello", "2026-05-17T10:00:00.000Z")),
      item(assistant(content, "2026-05-17T10:00:01.000Z", status)),
    ],
    tasks: [task({ status: "running", updatedAt: "2026-05-17T10:00:02.000Z" })],
    localTurn: IDLE_LOCAL_CHAT_TURN,
  });
}

function item(message: SerializableBotMessage): ChatMessageItem {
  return { id: `${message.role}-${message.createdAt}`, message };
}

function user(content: string, createdAt: string): SerializableBotMessage {
  return { role: "user", content, createdAt };
}

function assistant(
  content: string,
  createdAt: string,
  status?: Extract<SerializableBotMessage, { role: "assistant"; kind: "text" }>["status"],
): SerializableBotMessage {
  return { role: "assistant", kind: "text", content, createdAt, ...(status ? { status } : {}) };
}

function toolCall(createdAt: string): SerializableBotMessage {
  return {
    role: "assistant",
    kind: "tool_call",
    toolName: "artifact.write",
    toolArgs: { filename: "note.txt" },
    createdAt,
  };
}

function artifact(createdAt: string): SerializableBotMessage {
  return {
    role: "assistant",
    kind: "artifact",
    id: "artifact-1",
    sessionId,
    runId: "run-1",
    sandboxPath: "/outbox/note.txt",
    relativePath: "note.txt",
    title: "note.txt",
    description: null,
    filename: "note.txt",
    mimeType: "text/plain",
    sizeBytes: 5,
    previewKind: "text",
    textPreview: "hello",
    openUrl: "/api/artifacts/artifact-1",
    downloadUrl: "/api/artifacts/artifact-1?download=1",
    createdAt,
  };
}

function permission(
  status: "allowed" | "denied" | "timed_out",
  createdAt: string,
): SerializableBotMessage {
  return {
    role: "assistant",
    kind: "permission",
    requestId: "permission-1",
    toolName: "system.bash",
    status,
    command: "pwd",
    cwd: "/workspace",
    reason: "test",
    decidedAt: createdAt,
    createdAt,
  };
}

function task(overrides: Partial<TaskDto>): TaskDto {
  const status = overrides.status ?? "running";
  return {
    id: "task-1",
    kind: "chat.turn",
    status,
    title: "Chat task",
    reason: "Agent is working",
    resultSummary: null,
    errorSummary: null,
    canRetry: false,
    canCancel: status === "planned" || status === "running" || status === "paused_approval",
    conversationId: sessionId,
    relatedSessionId: sessionId,
    runtimeCommandId: null,
    queueJobId: null,
    memoryRunId: null,
    skillCandidateId: null,
    permissionRequestId: null,
    retryOfTaskId: null,
    attempt: 1,
    createdAt: "2026-05-17T10:00:00.500Z",
    updatedAt: "2026-05-17T10:00:00.500Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}
