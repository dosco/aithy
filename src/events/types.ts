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
  | { type: "agent.completed"; conversationId: string; agentResponse: string }
  | { type: "agent.clarification"; conversationId: string; question: string }
  | { type: "sandbox.created"; conversationId: string; sessionId: string }
  | { type: "sandbox.exec"; conversationId: string; command: string }
  | { type: "sandbox.destroyed"; conversationId: string; sessionId: string }
  | { type: "sandbox.mountsRefreshPending"; conversationId: string }
  | { type: "sandbox.mountsRefreshed"; conversationId: string; sessionId: string }
  | {
      type: "error";
      conversationId?: string;
      message: string;
      cause?: unknown;
    };

export type BotEventHandler = (event: BotEvent) => void;
