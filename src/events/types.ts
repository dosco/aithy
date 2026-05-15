import type { SetupStatusInput } from "../setup/status";
import type { AssistantToolCallMessage } from "../session/types";
import type { SystemPermissionRequest } from "../runtime/runtime-store";
import type { TaskRecord } from "../tasks/types";

export type BotEvent =
  | { type: "message.received"; conversationId: string; text: string }
  | {
      type: "agent.started";
      conversationId: string;
      provider: string;
      model: string;
    }
  | {
      type: "agent.turn";
      conversationId: string;
      summary: string;
      detail?: unknown;
    }
  | {
      type: "agent.tool_call";
      conversationId: string;
      message: AssistantToolCallMessage;
    }
  | { type: "agent.completed"; conversationId: string; agentResponse: string }
  | { type: "agent.clarification"; conversationId: string; question: string }
  | { type: "sandbox.starting"; conversationId: string }
  | { type: "sandbox.resuming"; conversationId: string; sessionId: string }
  | { type: "sandbox.created"; conversationId: string; sessionId: string }
  | { type: "sandbox.exec"; conversationId: string; command: string }
  | { type: "system.exec"; conversationId: string; command: string }
  | { type: "system.permission_request"; conversationId: string; request: SystemPermissionRequest }
  | { type: "task.status"; task: TaskRecord }
  | { type: "sandbox.destroyed"; conversationId: string; sessionId: string }
  | { type: "sandbox.mountsRefreshPending"; conversationId: string }
  | { type: "sandbox.mountsRefreshing"; conversationId: string; sessionId: string }
  | { type: "sandbox.mountsRefreshed"; conversationId: string; sessionId: string }
  | { type: "setup.status"; status: SetupStatusInput }
  | {
      type: "error";
      conversationId?: string;
      message: string;
      cause?: unknown;
    };

export type BotEventHandler = (event: BotEvent) => void;
