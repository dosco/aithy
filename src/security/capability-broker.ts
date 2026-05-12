import type { RuntimeStore } from "../runtime/runtime-store";

export interface CapabilityCheck {
  conversationId?: string;
  capability: string;
  toolName: string;
  argsPreview?: string;
}

const defaultLocalCapabilities = [
  "sandbox.bash",
  "sandbox.edit",
  "sandbox.mount",
  "sandbox.getPath",
  "web.scrape",
  "memory.remember",
  "audio.input",
  "audio.output",
] as const;

export class CapabilityBroker {
  constructor(private readonly store: RuntimeStore) {}

  ensureDefaultLocalGrants(): void {
    for (const capability of defaultLocalCapabilities) {
      this.store.ensureGrant(capability, "local default grant");
    }
  }

  require(input: CapabilityCheck): void {
    const decision = this.store.grantDecision(input.capability);
    this.store.auditTool({
      conversationId: input.conversationId,
      capability: input.capability,
      toolName: input.toolName,
      allowed: decision.allowed,
      reason: decision.reason,
      argsPreview: input.argsPreview,
    });
    if (!decision.allowed) {
      throw new Error(`Capability denied for ${input.toolName}: ${decision.reason}`);
    }
  }
}

export function argsPreview(value: unknown, maxChars = 500): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}
