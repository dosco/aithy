import type { SandboxProvider } from "../sandbox/provider";
import type { BotSession } from "../session/types";
import type { EventBus } from "../events/bus";
import type { SqliteMemoryStore } from "../memory/memory-store";
import type { NotificationCreate } from "../notifications/types";
import type { SessionManager } from "../session/session-manager";
import type { CapabilityBroker } from "../security/capability-broker";
import type { RuntimeStore } from "../runtime/runtime-store";
import type { PermissionDecisionStatus } from "../session/types";
import type { SqliteArtifactStore } from "../artifacts/artifact-store";
import type { SqliteTaskStore } from "../tasks/task-store";
import type { AutomationToolActions } from "../automations/tool-actions";
import type { SqliteSkillsStore } from "../skills/skills-store";

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
  /** DB-backed skill bundles available to permission-free skill helper tools. */
  skills?: SqliteSkillsStore;
  /** Skill ids loaded into the current agent turn. */
  loadedSkillIds?: Set<string>;
  /** Enqueue a high-priority memory triage on the memory queue. */
  enqueueRemember?: (req: RememberRequest) => Promise<void>;
  /** Push a notification (SQLite + live SSE). Comes from the runtime. */
  notify?: (input: NotificationCreate) => void;
  /** Capability checks and audit logging for sensitive tools. */
  capabilities?: CapabilityBroker;
  /** User-facing artifact publishing from /outbox. */
  artifacts?: SqliteArtifactStore;
  /** Current agent run id for run-scoped artifacts. */
  artifactRunId?: string;
  /** Current run's sandbox outbox path, e.g. /outbox/<session>/<run>. */
  artifactRunOutboxPath?: string;
  /** Runtime store for approval requests and other cross-process state. */
  runtimeStore?: RuntimeStore;
  /** User-visible task ledger exposed through read-only task tools. */
  tasks?: SqliteTaskStore;
  /** Create and manage scheduled synthetic agent turns. */
  automations?: AutomationToolActions;
  /** Current user-visible task for this agent run, when the turn was queued through the task ledger. */
  taskId?: string;
  /** Per-run guard against automatically repeating expired/denied host prompts. */
  systemPermissionDecisions?: Map<string, PermissionDecisionStatus | "pending">;
  /** Flush queued remote session writes when a tool emits durable chat state. */
  flushSessionState?: () => Promise<void>;
}
