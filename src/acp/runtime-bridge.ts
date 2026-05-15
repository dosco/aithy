import { handleSlashCommand } from "../commands/slash-commands";
import type { ChannelCommand } from "../channel/types";
import { generateSessionName } from "../session/session-names";
import type { WebLiveEvent } from "../web/live-events";
import { getAithyRuntime, type AithyRuntime } from "../runtime/aithy-runtime.server";
import type {
  AithyAcpBridge,
  AithyAcpRunPromptInput,
  AithyAcpRunPromptResult,
} from "./agent";

interface AcpSession {
  acpSessionId: string;
  conversationId: string;
  cwd: string;
  generation: number;
  needsFreshConversation: boolean;
}

type RuntimeFactory = () => Promise<AithyRuntime>;

export class AithyRuntimeAcpBridge implements AithyAcpBridge {
  private readonly sessions = new Map<string, AcpSession>();
  private runtimePromise?: Promise<AithyRuntime>;

  constructor(private readonly getRuntime: RuntimeFactory = getAithyRuntime) {}

  async createSession(params: Parameters<AithyAcpBridge["createSession"]>[0]) {
    const runtime = await this.runtime();
    const acpSessionId = crypto.randomUUID();
    const conversationId = `acp-${acpSessionId}`;
    runtime.sessions.ensureLogicalSession(conversationId, {
      name: "ACP Session",
      nameSource: "generated",
      source: "acp",
    });
    await runtime.sessionState.flush();
    this.sessions.set(acpSessionId, {
      acpSessionId,
      conversationId,
      cwd: params.cwd,
      generation: 0,
      needsFreshConversation: false,
    });
    return { sessionId: acpSessionId };
  }

  async runPrompt(input: AithyAcpRunPromptInput): Promise<AithyAcpRunPromptResult> {
    const session = this.requireSession(input.sessionId);
    const runtime = await this.runtime();
    if (input.signal?.aborted) return { cancelled: true };
    if (session.needsFreshConversation) {
      this.rotateConversation(runtime, session);
      await runtime.sessionState.flush();
    }

    const text = input.text.trim();
    if (text.startsWith("/")) return this.runSlashCommand(runtime, session, text);

    const createdAt = new Date();
    runtime.sessions.ensureLogicalSession(session.conversationId, {
      name: generateSessionName(text),
      nameSource: "generated",
      source: "acp",
    });
    runtime.sessions.appendMessages(session.conversationId, [{
      role: "user",
      content: text,
      createdAt: createdAt.toISOString(),
    }]);
    await runtime.sessionState.flush();
    const afterUserMessageId = runtime.sessions.lastMessageId(session.conversationId);
    const responseRunId = crypto.randomUUID();
    runtime.assertReady();

    return this.waitForAssistantText(runtime, {
      conversationId: session.conversationId,
      afterUserMessageId,
      responseRunId,
      signal: input.signal,
      start: () => runtime.dispatcher.enqueueUserChat({
        conversationId: session.conversationId,
        text,
        createdAt: createdAt.toISOString(),
        skillIds: [],
        disableSystemBash: true,
        responseRunId,
      }),
    });
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.needsFreshConversation = true;
    const runtime = await this.runtime();
    await runtime.dispatcher.cancelByConversation(session.conversationId);
  }

  async shutdown(): Promise<void> {
    if (!this.runtimePromise) return;
    const runtime = await this.runtimePromise.catch(() => undefined);
    this.runtimePromise = undefined;
    await runtime?.shutdown();
  }

  private async runSlashCommand(
    runtime: AithyRuntime,
    session: AcpSession,
    text: string,
  ): Promise<AithyAcpRunPromptResult> {
    const result = await handleSlashCommand(commandMessage(session.conversationId, text), {
      sessions: runtime.sessions,
    });
    if (result.activeConversationId) {
      session.conversationId = result.activeConversationId;
    }
    await runtime.sessionState.flush();
    return { text: result.reply.text };
  }

  private waitForAssistantText(runtime: AithyRuntime, input: {
    conversationId: string;
    afterUserMessageId: number | null;
    responseRunId: string;
    signal: AbortSignal | undefined;
    start: () => Promise<unknown>;
  }): Promise<AithyAcpRunPromptResult> {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      let settled = false;
      const finish = (result: AithyAcpRunPromptResult, error?: unknown) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        input.signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve(result);
      };
      const onAbort = () => finish({ cancelled: true });
      input.signal?.addEventListener("abort", onAbort, { once: true });
      unsubscribe = runtime.live.subscribe((event) => {
        const text = assistantTextFromEvent(
          event,
          input.conversationId,
          input.afterUserMessageId,
          input.responseRunId,
        );
        if (text !== undefined) finish({ text });
      });
      input.start().catch((error) => finish({}, error));
    });
  }

  private requireSession(sessionId: string): AcpSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`ACP session not found: ${sessionId}`);
    return session;
  }

  private runtime(): Promise<AithyRuntime> {
    this.runtimePromise ??= this.getRuntime();
    return this.runtimePromise;
  }

  private rotateConversation(runtime: AithyRuntime, session: AcpSession): void {
    session.generation += 1;
    session.conversationId = `acp-${session.acpSessionId}-${session.generation}`;
    session.needsFreshConversation = false;
    runtime.sessions.ensureLogicalSession(session.conversationId, {
      name: "ACP Session",
      nameSource: "generated",
      source: "acp",
    });
  }
}

function commandMessage(conversationId: string, text: string): ChannelCommand {
  return {
    id: crypto.randomUUID(),
    kind: "command",
    channelId: "acp",
    conversationId,
    senderId: "local-user",
    text,
    createdAt: new Date(),
  };
}

function assistantTextFromEvent(
  event: WebLiveEvent,
  conversationId: string,
  afterUserMessageId: number | null,
  responseRunId: string,
): string | undefined {
  if (event.type !== "message") return undefined;
  if (event.conversationId !== conversationId) return undefined;
  if (!isReplyAfterPrompt(event.messageId, afterUserMessageId)) return undefined;
  if (event.runId !== responseRunId) return undefined;
  const message = event.message;
  if (message.role !== "assistant" || message.kind !== "text") return undefined;
  return message.content;
}

function isReplyAfterPrompt(
  eventMessageId: number | undefined,
  afterUserMessageId: number | null,
): boolean {
  if (afterUserMessageId === null) return true;
  return typeof eventMessageId === "number" && eventMessageId > afterUserMessageId;
}
