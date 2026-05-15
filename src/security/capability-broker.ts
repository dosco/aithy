import type { RuntimeStore } from "../runtime/runtime-store";
import type { CapabilityMatchContext } from "./capability-policy";

export interface CapabilityCheck {
  conversationId?: string;
  capability: string;
  toolName: string;
  argsPreview?: string;
  matchContext?: CapabilityMatchContext;
}

const defaultLocalCapabilities = [
  "sandbox.bash",
  "sandbox.edit",
  "artifact.write",
  "artifact.publish",
  "memory.remember",
  "audio.input",
  "audio.output",
] as const;

const governedCapabilities = new Set([
  "system.bash",
  "sandbox.mount",
  "sandbox.getPath",
  "web.search",
  "web.scrape",
]);

export class CapabilityBroker {
  constructor(private readonly store: RuntimeStore) {}

  ensureDefaultLocalGrants(): void {
    for (const capability of defaultLocalCapabilities) {
      this.store.ensureGrant(capability, "local default grant");
    }
  }

  require(input: CapabilityCheck): void {
    const policy = this.store.capabilityPolicyDecision(input.capability, input.matchContext);
    const decision = policy.allowed || governedCapabilities.has(input.capability)
      ? policy
      : this.store.grantDecision(input.capability);
    this.audit({ ...input, allowed: decision.allowed, reason: decision.reason });
    if (!decision.allowed) {
      throw new Error(`Capability denied for ${input.toolName}: ${decision.reason}`);
    }
  }

  audit(input: CapabilityCheck & { allowed: boolean; reason: string }): void {
    this.store.auditTool({
      conversationId: input.conversationId,
      capability: input.capability,
      toolName: input.toolName,
      allowed: input.allowed,
      reason: input.reason,
      argsPreview: input.argsPreview,
    });
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
