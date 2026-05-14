import { runMessage } from "../agent/run-message";
import type { ActiveRunRegistry } from "../agent/active-runs";
import type { UserChatJobData, UserChatJobResult } from "../agent/dispatcher";
import type { ChannelMessage } from "../channel/types";
import type { AppConfig } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SqliteMemoryStore } from "../memory/memory-store";
import type { MemoryQueue } from "../memory/memory-queue";
import type { NotificationCreate, NotificationEntry } from "../notifications/types";
import type { UserProfile } from "../profile/types";
import type { SandboxProvider } from "../sandbox/provider";
import type { CapabilityBroker } from "../security/capability-broker";
import type { SessionManager } from "../session/session-manager";
import type { SoulProfile } from "../soul/types";
import { formatSkillContent } from "../skills/skills-store";
import type { SqliteSkillsStore } from "../skills/skills-store";
import type { SqliteUsageStore } from "../usage/usage-store";
import type { RuntimeStore } from "./runtime-store";

interface RuntimeForUserChat {
  config: AppConfig;
  events: EventBus;
  sandbox: SandboxProvider;
  sessions: SessionManager;
  soul: SoulProfile;
  profile?: UserProfile;
  memory: SqliteMemoryStore;
  memoryQueue: MemoryQueue;
  usage: SqliteUsageStore;
  activeRuns: ActiveRunRegistry;
  skills: SqliteSkillsStore;
  capabilities?: CapabilityBroker;
  runtimeStore?: RuntimeStore;
  notify(input: NotificationCreate): NotificationEntry;
  flushSessionState?(): Promise<void>;
}

export async function processUserChatJob(
  runtime: RuntimeForUserChat,
  data: UserChatJobData,
): Promise<UserChatJobResult> {
  const message: ChannelMessage = {
    id: crypto.randomUUID(),
    channelId: "web",
    conversationId: data.conversationId,
    senderId: "local-user",
    text: data.text,
    createdAt: new Date(data.createdAt),
  };
  const selectedSkills = runtime.skills.getByIds([...data.skillIds]);
  runtime.skills.incrementRetrieved(selectedSkills.map(({ id }) => id));
  const skills = selectedSkills.map((skill) => ({ name: skill.name, content: formatSkillContent(skill) }));
  const reply = await runMessage(message, {
    config: runtime.config,
    events: runtime.events,
    sandbox: runtime.sandbox,
    sessions: runtime.sessions,
    soul: runtime.soul,
    profile: runtime.profile,
    memory: runtime.memory,
    memoryQueue: runtime.memoryQueue,
    usage: runtime.usage,
    activeRuns: runtime.activeRuns,
    capabilities: runtime.capabilities,
    runtimeStore: runtime.runtimeStore,
    notify: (input) => runtime.notify(input),
    flushSessionState: runtime.flushSessionState ? () => runtime.flushSessionState?.() ?? Promise.resolve() : undefined,
    skills,
    userMessagePersisted: true,
    skillsSearch: (queries) =>
      runtime.skills.search(queries).map((s) => ({ name: s.name, content: formatSkillContent(s) })),
  });
  await runtime.flushSessionState?.();
  const assistant = [...runtime.sessions.getTranscript(reply.conversationId)]
    .reverse()
    .find((item) =>
      item.role === "assistant"
      && item.kind === "text"
      && item.content === reply.text
    );
  return {
    conversationId: reply.conversationId,
    text: reply.text,
    createdAt: assistant?.createdAt ?? new Date().toISOString(),
  };
}
