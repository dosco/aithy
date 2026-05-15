import {
  PROTOCOL_VERSION,
  type Agent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type AuthenticateResponse,
  type CancelNotification,
  type ContentBlock,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from "@agentclientprotocol/sdk";

export interface AithyAcpRunPromptInput {
  sessionId: string;
  text: string;
  signal?: AbortSignal;
}

export interface AithyAcpRunPromptResult {
  text?: string;
  cancelled?: boolean;
}

export interface AithyAcpBridge {
  createSession(params: NewSessionRequest): Promise<NewSessionResponse>;
  runPrompt(input: AithyAcpRunPromptInput): Promise<AithyAcpRunPromptResult>;
  cancel(sessionId: string): Promise<void>;
}

export class AithyAcpAgent implements Agent {
  private readonly pendingPrompts = new Map<string, AbortController>();

  constructor(
    private readonly connection: AgentSideConnection,
    private readonly bridge: AithyAcpBridge,
  ) {}

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {},
      },
    };
  }

  async authenticate(_params: AuthenticateRequest): Promise<AuthenticateResponse> {
    return {};
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    return this.bridge.createSession(params);
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const text = textFromPrompt(params.prompt);
    const previous = this.pendingPrompts.get(params.sessionId);
    previous?.abort();
    if (previous) await this.bridge.cancel(params.sessionId);

    const controller = new AbortController();
    this.pendingPrompts.set(params.sessionId, controller);
    try {
      const result = await this.bridge.runPrompt({
        sessionId: params.sessionId,
        text,
        signal: controller.signal,
      });
      if (controller.signal.aborted || result.cancelled) {
        return { stopReason: "cancelled" };
      }
      if (result.text) {
        await this.connection.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: result.text },
          },
        });
      }
      return { stopReason: "end_turn" };
    } finally {
      if (this.pendingPrompts.get(params.sessionId) === controller) {
        this.pendingPrompts.delete(params.sessionId);
      }
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.pendingPrompts.get(params.sessionId)?.abort();
    await this.bridge.cancel(params.sessionId);
  }
}

function textFromPrompt(blocks: readonly ContentBlock[]): string {
  const parts = blocks.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "resource_link") {
      const label = block.title ?? block.name;
      return label ? `${label}: ${block.uri}` : block.uri;
    }
    throw new Error(`ACP prompt content type is not supported yet: ${block.type}`);
  });
  const text = parts.join("\n\n").trim();
  if (!text) throw new Error("ACP prompt did not include text");
  return text;
}
