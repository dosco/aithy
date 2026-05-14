import type { SandboxProvider } from "../sandbox/provider";
import type { BotSession } from "../session/types";
import type { EventBus } from "../events/bus";
import type { SqliteMemoryStore } from "../memory/memory-store";
import type { NotificationCreate } from "../notifications/types";
import type { SessionManager } from "../session/session-manager";
import type { CapabilityBroker } from "../security/capability-broker";
import type { RuntimeStore } from "../runtime/runtime-store";
import type { PermissionDecisionStatus } from "../session/types";

export interface RememberRequest {
  hint: string;
  sessionId: string;
}

export interface ToolContext {
  session: BotSession;
  sandbox: SandboxProvider;
  sessions: SessionManager;
  workspacePath: string;
  events: EventBus;
  memory?: SqliteMemoryStore;
  /** Enqueue a high-priority memory triage on the memory queue. */
  enqueueRemember?: (req: RememberRequest) => Promise<void>;
  /** Push a notification (SQLite + live SSE). Comes from the runtime. */
  notify?: (input: NotificationCreate) => void;
  /** Capability checks and audit logging for sensitive tools. */
  capabilities?: CapabilityBroker;
  /** Runtime store for approval requests and other cross-process state. */
  runtimeStore?: RuntimeStore;
  /** Per-run guard against automatically repeating expired/denied host prompts. */
  systemPermissionDecisions?: Map<string, PermissionDecisionStatus | "pending">;
  /** Flush queued remote session writes when a tool emits durable chat state. */
  flushSessionState?: () => Promise<void>;
}
