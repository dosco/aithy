import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SelectedSkill } from "@/components/chat-composer";
import { appendUnique } from "@/components/chat-message-state";
import {
  deriveChatTurn,
  IDLE_LOCAL_CHAT_TURN,
  shouldDrainPending,
  type ChatTurn,
  type LocalChatTurn,
} from "@/components/chat-turn-model";
import { useLiveEvent } from "@/components/live-events";
import type { PendingChatMessage } from "@/components/pending-chat-queue-state";
import { useChatMessages } from "@/components/use-chat-messages";
import { usePendingChatQueue } from "@/components/use-pending-chat-queue";
import {
  respondSystemPermission,
  retryTask,
  sendChatMessage,
  stopChatMessage,
} from "@/server/actions.functions";
import type { MessagePageDto, WebStateDto } from "@/server/dto";
import type { CapabilityMatchKind } from "../../src/security/capability-policy";
import { newSpecificSessionId } from "../../src/session/home-session";
import type { SerializableBotMessage, WebLiveEvent } from "../../src/web/live-events";

type PermissionMessage = Extract<SerializableBotMessage, { kind: "permission" }>;
type ActivityEvent = Extract<WebLiveEvent, { type: "activity" }>;

interface SubmitTextOptions {
  clearInput?: boolean;
  pendingMessage?: PendingChatMessage;
  selectedSkillsOverride?: SelectedSkill[];
  useSelectedSkills?: boolean;
}

interface UseChatControllerInput {
  initialState: WebStateDto;
  resolvedInitialSessionId: string | null;
  initialPage: MessagePageDto;
  navigateToSession: (sessionId: string) => void | Promise<void>;
}

export function useChatController({
  initialState,
  resolvedInitialSessionId,
  initialPage,
  navigateToSession,
}: UseChatControllerInput) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    resolvedInitialSessionId,
  );
  const {
    messages,
    setMessages,
    hasMoreBefore,
    loadingMore,
    loadMoreMessages,
  } = useChatMessages(resolvedInitialSessionId, initialPage);
  const [sessions, setSessions] = useState(initialState.sessions);
  const [activities, setActivities] = useState<ActivityEvent[]>(initialState.activities);
  const [permissionRequests, setPermissionRequests] = useState(initialState.pendingPermissions);
  const [tasks, setTasks] = useState(initialState.tasks);
  const [input, setInput] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<SelectedSkill[]>([]);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null);
  const [localTurn, setLocalTurn] = useState<LocalChatTurn>(IDLE_LOCAL_CHAT_TURN);
  const [retryingTaskIds, setRetryingTaskIds] = useState<Set<string>>(() => new Set());
  const activeSessionRef = useRef<string | null>(activeSessionId);
  const localTurnRef = useRef<LocalChatTurn>(localTurn);
  const previousTurnRef = useRef<ChatTurn | null>(null);

  activeSessionRef.current = activeSessionId;
  localTurnRef.current = localTurn;

  const {
    pendingMessages,
    enqueuePending,
    removePending,
    dequeuePending,
    restorePending,
  } = usePendingChatQueue(activeSessionId);

  const turn = useMemo(
    () => deriveChatTurn({ sessionId: activeSessionId, messages, tasks, localTurn }),
    [activeSessionId, messages, tasks, localTurn],
  );

  const activeSession = useMemo(
    () => sessions.find((session) => session.conversationId === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );
  const childSessions = useMemo(
    () => activeSessionId
      ? sessions.filter((session) => session.parentSessionId === activeSessionId)
      : [],
    [sessions, activeSessionId],
  );
  const previewSession = useMemo(
    () => sessions.find((session) => session.conversationId === previewSessionId) ?? null,
    [sessions, previewSessionId],
  );
  const retryableChatTasks = useMemo(
    () => tasks.filter((task) =>
      task.kind === "chat.turn"
      && (task.relatedSessionId === activeSessionId || task.conversationId === activeSessionId)
      && task.status === "failed"
      && task.canRetry),
    [activeSessionId, tasks],
  );

  useEffect(() => {
    setActiveSessionId(resolvedInitialSessionId);
    setSessions(initialState.sessions);
    setActivities(initialState.activities);
    setPermissionRequests(initialState.pendingPermissions);
    setTasks(initialState.tasks);
    setPreviewSessionId(null);
    setLocalTurn(IDLE_LOCAL_CHAT_TURN);
    previousTurnRef.current = null;
  }, [
    resolvedInitialSessionId,
    initialState.sessions,
    initialState.activities,
    initialState.pendingPermissions,
    initialState.tasks,
  ]);

  useLiveEvent((event) => {
    if (event.type === "sessions") setSessions(event.sessions);
    if (event.type === "task-status") {
      setTasks((current) => [event.task, ...current.filter((task) => task.id !== event.task.id)]);
    }
    if (!("conversationId" in event) || event.conversationId !== activeSessionRef.current) {
      return;
    }
    if (event.type === "message") {
      const message = event.message;
      setMessages((current) =>
        appendUnique(current, { id: event.id, message }));
      if (isPermissionMessage(message)) {
        setPermissionRequests((current) =>
          current.filter((request) => request.id !== message.requestId));
      }
      if (message.role === "assistant" && message.kind === "text") {
        const turnToComplete = localTurnRef.current;
        if (assistantCompletesLocalTurn(turnToComplete, event.conversationId, message.createdAt)) {
          setLocalTurn(IDLE_LOCAL_CHAT_TURN);
        }
      }
    }
    if (event.type === "permission-request") {
      setPermissionRequests((current) => updatePermissionRequests(current, event.request));
    }
    if (event.type === "activity") {
      setActivities((current) => [...current.slice(-79), event]);
    }
  });

  const submitText = useCallback(async (
    rawText: string,
    options: SubmitTextOptions = {},
  ) => {
    const text = rawText.trim();
    if (!text) return;
    const isCommand = text.startsWith("/");
    const useSelectedSkills = options.useSelectedSkills ?? true;
    const skillsForTurn = options.selectedSkillsOverride
      ?? (useSelectedSkills ? selectedSkills : []);
    if (turn.busy && activeSessionId && !options.pendingMessage) {
      enqueuePending({
        conversationId: activeSessionId,
        text,
        skills: isCommand ? [] : skillsForTurn,
      });
      if (options.clearInput) setInput("");
      if (useSelectedSkills) setSelectedSkills([]);
      return;
    }

    if (options.clearInput) setInput("");
    const wasDraft = !activeSessionId;
    const conversationId = activeSessionId ?? newSpecificSessionId();
    const createdAt = new Date().toISOString();
    const nextLocalTurn: LocalChatTurn = {
      conversationId,
      userCreatedAt: isCommand ? null : createdAt,
      taskId: null,
      phase: "submitting",
    };
    setLocalTurn(nextLocalTurn);
    if (wasDraft) setActiveSessionId(conversationId);
    if (!isCommand) {
      setMessages((current) =>
        appendUnique(current, {
          id: `optimistic-user-${createdAt}`,
          message: { role: "user", content: text, createdAt },
        }));
    }

    const skillIds = skillsForTurn.map((skill) => skill.id);
    try {
      const result = await sendChatMessage({
        data: { conversationId, text, createdAt, skillIds },
      });
      const taskId = taskIdFromResult(result);
      const queued = Boolean(result.queued && !isCommand);
      setLocalTurn(queued
        ? { ...nextLocalTurn, taskId, phase: "awaiting_reply" }
        : IDLE_LOCAL_CHAT_TURN);
      if (!isCommand && useSelectedSkills && !options.pendingMessage) setSelectedSkills([]);
      if (result.activeSessionId !== conversationId) {
        setActiveSessionId(result.activeSessionId);
        await navigateToSession(result.activeSessionId);
      } else if (wasDraft) {
        await navigateToSession(conversationId);
      }
    } catch (error) {
      setLocalTurn(IDLE_LOCAL_CHAT_TURN);
      if (options.pendingMessage) restorePending(options.pendingMessage);
      throw error;
    }
  }, [
    activeSessionId,
    enqueuePending,
    navigateToSession,
    restorePending,
    selectedSkills,
    setMessages,
    turn.busy,
  ]);

  useEffect(() => {
    const previous = previousTurnRef.current;
    previousTurnRef.current = turn;
    if (!shouldDrainPending({ previous, current: turn })) return;
    if (!activeSessionId || pendingMessages.length === 0) return;
    const next = dequeuePending(activeSessionId);
    if (!next) return;
    void submitText(next.text, {
      pendingMessage: next,
      selectedSkillsOverride: next.skills,
      useSelectedSkills: false,
    }).catch(() => {});
  }, [activeSessionId, dequeuePending, pendingMessages.length, submitText, turn]);

  const submit = useCallback(async () => {
    await submitText(input, { clearInput: true });
  }, [input, submitText]);

  const stop = useCallback(() => {
    setLocalTurn(IDLE_LOCAL_CHAT_TURN);
    if (activeSessionId) void stopChatMessage({ data: { conversationId: activeSessionId } });
  }, [activeSessionId]);

  const retryPermission = useCallback(async (message: PermissionMessage) => {
    await submitText(retryPermissionPrompt(message), { useSelectedSkills: false });
  }, [submitText]);

  const retryFailedTask = useCallback(async (taskId: string) => {
    setRetryingTaskIds((current) => new Set(current).add(taskId));
    try {
      await retryTask({ data: { taskId } });
    } finally {
      setRetryingTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
  }, []);

  const editPendingMessage = useCallback((message: PendingChatMessage) => {
    removePending(message.conversationId, message.id);
    setInput(message.text);
    setSelectedSkills(message.skills);
  }, [removePending]);

  const deletePendingMessage = useCallback((message: PendingChatMessage) => {
    removePending(message.conversationId, message.id);
  }, [removePending]);

  const handlePermissionDecision = useCallback((
    requestId: string,
    decision: "allow" | "deny",
    persist?: string,
  ) => {
    setPermissionRequests((current) =>
      current.filter((request) => request.id !== requestId));
    void respondSystemPermission({
      data: {
        requestId,
        decision,
        persist: persist as CapabilityMatchKind | undefined,
      },
    });
  }, []);

  return {
    activeSessionId,
    activeSession,
    childSessions,
    previewSession,
    setPreviewSessionId,
    messages,
    activities,
    permissionRequests,
    hasMoreBefore,
    loadingMore,
    loadMoreMessages,
    input,
    selectedSkills,
    setInput,
    setSelectedSkills,
    sessionBusy: turn.busy,
    retryableChatTasks,
    retryingTaskIds,
    pendingMessages,
    submit,
    stop,
    editPendingMessage,
    deletePendingMessage,
    retryPermission,
    retryFailedTask,
    handlePermissionDecision,
  };
}

function updatePermissionRequests(
  current: WebStateDto["pendingPermissions"],
  request: WebStateDto["pendingPermissions"][number],
) {
  if (request.status !== "pending") {
    return current.filter((item) => item.id !== request.id);
  }
  const index = current.findIndex((item) => item.id === request.id);
  if (index === -1) return [...current, request];
  return current.map((item) => item.id === request.id ? request : item);
}

function retryPermissionPrompt(message: PermissionMessage): string {
  return [
    "Retry the expired command on my computer.",
    "",
    "Command:",
    message.command,
    "",
    "Folder:",
    message.cwd,
    "",
    "Reason:",
    message.reason,
  ].join("\n");
}

function assistantCompletesLocalTurn(
  localTurn: LocalChatTurn,
  conversationId: string,
  assistantCreatedAt: string,
): boolean {
  return localTurn.phase !== "idle"
    && localTurn.conversationId === conversationId
    && (!localTurn.userCreatedAt || assistantCreatedAt >= localTurn.userCreatedAt);
}

function isPermissionMessage(message: SerializableBotMessage): message is PermissionMessage {
  return message.role === "assistant" && message.kind === "permission";
}

function taskIdFromResult(result: unknown): string | null {
  if (!result || typeof result !== "object" || !("taskId" in result)) return null;
  return typeof result.taskId === "string" ? result.taskId : null;
}
