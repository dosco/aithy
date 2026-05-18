import { runMessage } from "../agent/run-message";
import type { AxAgentSkillResult, AxAgentUsedSkill } from "@ax-llm/ax";
import type { ActiveRunRegistry } from "../agent/active-runs";
import type { SqliteArtifactStore } from "../artifacts/artifact-store";
import type { UserChatJobData, UserChatJobResult } from "../agent/dispatcher";
import type { ChannelMessage } from "../channel/types";
import type { AppConfig } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SqliteMemoryStore } from "../memory/memory-store";
import type { MemoryQueue } from "../memory/memory-queue";
import type { SqliteEpisodeStore } from "../episodes/episode-store";
import type { DreamQueue } from "../episodes/dream-queue";
import type { SkillCandidateQueue } from "../skills/candidate-queue";
import type { NotificationCreate, NotificationEntry } from "../notifications/types";
import type { UserProfile } from "../profile/types";
import type { SandboxProvider } from "../sandbox/provider";
import type { CapabilityBroker } from "../security/capability-broker";
import type { SessionManager } from "../session/session-manager";
import type { SoulProfile } from "../soul/types";
import { formatSkillContent, type SkillMatchKind } from "../skills/skills-store";
import type { SkillResolvedMatch, SqliteSkillsStore } from "../skills/skills-store";
import type { SqliteUsageStore } from "../usage/usage-store";
import type { RuntimeStore } from "./runtime-store";
import type { SqliteTaskStore } from "../tasks/task-store";
import type { AutomationToolActions } from "../automations/tool-actions";

interface RuntimeForUserChat {
  config: AppConfig;
  events: EventBus;
  sandbox: SandboxProvider;
  sessions: SessionManager;
  soul: SoulProfile;
  profile?: UserProfile;
  memory: SqliteMemoryStore;
  episodes?: SqliteEpisodeStore;
  artifacts: SqliteArtifactStore;
  memoryQueue: MemoryQueue;
  dreamQueue?: DreamQueue;
  skillCandidateQueue?: SkillCandidateQueue;
  usage: SqliteUsageStore;
  activeRuns: ActiveRunRegistry;
  skills: SqliteSkillsStore;
  capabilities?: CapabilityBroker;
  runtimeStore?: RuntimeStore;
  tasks?: SqliteTaskStore;
  automationActions?: AutomationToolActions;
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
  const trackedSkills = createTrackedSkills(runtime.skills, data.skillIds, {
    sessionId: data.conversationId,
    taskId: data.taskId,
  });
  const reply = await runMessage(message, {
    config: runtime.config,
    events: runtime.events,
    sandbox: runtime.sandbox,
    sessions: runtime.sessions,
    soul: runtime.soul,
    profile: runtime.profile,
    memory: runtime.memory,
    episodes: runtime.episodes,
    artifacts: runtime.artifacts,
    memoryQueue: runtime.memoryQueue,
    usage: runtime.usage,
    activeRuns: runtime.activeRuns,
    capabilities: runtime.capabilities,
    runtimeStore: runtime.runtimeStore,
    tasks: runtime.tasks,
    automations: runtime.automationActions,
    taskId: data.taskId,
    notify: (input) => runtime.notify(input),
    flushSessionState: runtime.flushSessionState ? () => runtime.flushSessionState?.() ?? Promise.resolve() : undefined,
    skills: trackedSkills.skills,
    skillsStore: runtime.skills,
    loadedSkillIds: trackedSkills.loadedSkillIds,
    userMessagePersisted: true,
    skillsSearch: trackedSkills.skillsSearch,
    onLoadedSkills: trackedSkills.onLoadedSkills,
    onUsedSkills: trackedSkills.onUsedSkills,
  });
  await runtime.flushSessionState?.();
  await enqueuePostTurnBackgroundTasks(runtime, data.conversationId);
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

export async function enqueuePostTurnBackgroundTasks(
  runtime: Pick<RuntimeForUserChat, "sessions" | "dreamQueue" | "skillCandidateQueue" | "events">,
  conversationId: string,
): Promise<void> {
  const summary = runtime.sessions.getSummary(conversationId);
  if (summary?.parentSessionId) return;
  try {
    await runtime.dreamQueue?.enqueueAuto(conversationId);
  } catch (error) {
    runtime.events.emit({
      type: "error",
      conversationId,
      message: error instanceof Error ? error.message : "Failed to enqueue dream task",
    });
  }
  try {
    await runtime.skillCandidateQueue?.enqueueAuto();
  } catch (error) {
    runtime.events.emit({
      type: "error",
      conversationId,
      message: error instanceof Error ? error.message : "Failed to enqueue skill candidate task",
    });
  }
}

export function createTrackedSkills(
  store: SqliteSkillsStore,
  selectedIds: readonly string[],
  context: { sessionId?: string | null; taskId?: string | null } = {},
) {
  const selectedSkills = store.getByIds([...selectedIds]);
  const loadedSkillIds = new Set<string>();
  const usedSkillIds = new Set<string>();
  const recordLoaded = (matches: readonly SkillResolvedMatch[]) => {
    const ids = matches.map(({ skill }) => skill.id).filter((id) => !loadedSkillIds.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => loadedSkillIds.add(id));
    store.incrementRetrieved(ids);
    for (const match of matches) {
      if (!ids.includes(match.skill.id)) continue;
      store.recordEvent({
        eventType: "loaded",
        skillId: match.skill.id,
        sessionId: context.sessionId,
        taskId: context.taskId,
        query: match.query,
        matchKind: match.matchKind,
        queries: [match.query],
      });
    }
  };
  const selectedMatches: SkillResolvedMatch[] = selectedSkills.map((skill) => ({
    skill,
    query: skill.id,
    matchKind: "id" as SkillMatchKind,
  }));
  const recordUsed = (usedSkills: readonly AxAgentUsedSkill[]) => {
    for (const used of usedSkills) {
      if (!loadedSkillIds.has(used.id) || usedSkillIds.has(used.id)) continue;
      usedSkillIds.add(used.id);
      store.recordEvent({
        eventType: "used",
        skillId: used.id,
        sessionId: context.sessionId,
        taskId: context.taskId,
        stage: used.stage,
        reason: used.reason,
      });
    }
  };
  recordLoaded(selectedMatches);
  return {
    loadedSkillIds,
    skills: selectedSkills.map((skill) => ({ id: skill.id, name: skill.name, content: formatSkillContent(skill) })),
    skillsSearch: (queries: readonly string[]) => {
      const matches = store.resolveSearchQueries(queries);
      recordLoaded(matches);
      return matches.map(({ skill }) => ({ id: skill.id, name: skill.name, content: formatSkillContent(skill) }));
    },
    onLoadedSkills: (results: readonly AxAgentSkillResult[]) => {
      const matches = results.flatMap((result): SkillResolvedMatch[] => {
        if (!result.id || loadedSkillIds.has(result.id)) return [];
        const skill = store.get(result.id);
        return skill ? [{ skill, query: result.id, matchKind: "id" }] : [];
      });
      recordLoaded(matches);
    },
    onUsedSkills: recordUsed,
  };
}
