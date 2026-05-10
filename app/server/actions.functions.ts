import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ChannelCommand, ChannelMessage } from "../../src/channel/types";
import { handleSlashCommand } from "../../src/commands/slash-commands";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import {
  deleteProviderApiKey,
  normalizePostedSecret,
  writeProviderApiKey,
} from "../../src/settings/secrets";
import { isAiConfigured } from "../../src/config/validate";
import {
  getAithyRuntime,
  resetAithyRuntimeSystem,
} from "../../src/runtime/aithy-runtime.server";
import { generateSessionName } from "../../src/session/session-names";
import { messageEvent, userMessageEvent } from "../../src/web/live-events";
import {
  webStateDto,
  sessionDto,
  secretStatus,
  secretStatusForProvider,
  configDto,
  soulDto,
  memoryRunDto,
  notificationDto,
  usageBucketDto,
} from "./dto";
import { assertPrimaryAiSettings } from "./ai-settings-test";

const sessionInput = z.object({
  conversationId: z.string().min(1).optional(),
});

const sendInput = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1),
  skillIds: z.array(z.string().min(1)).max(20).optional(),
});

const renameInput = z.object({
  conversationId: z.string().min(1),
  name: z.string().min(1),
});

const confirmationInput = z.object({
  confirmation: z.literal("Yes, I'm sure"),
});

const settingsInput = z.object({
  runtime: z.object({
    aiProvider: z.string().optional(),
    aiApiKey: z.string().optional().nullable(),
    aiModel: z.string().optional().nullable(),
    fastAiProvider: z.string().optional(),
    fastAiModel: z.string().optional(),
    sandboxProvider: z.enum(["microsandbox", "disabled"]).optional(),
    sandboxImage: z.string().optional(),
    sandboxCpus: z.number().positive().optional(),
    sandboxMemoryMb: z.number().positive().optional(),
    sandboxNetwork: z.enum(["none", "public", "allow-all"]).optional(),
    sessionTtlMs: z.number().positive().optional(),
    parallelAgents: z.number().int().min(1).max(8).optional(),
    traceEnabled: z.boolean().optional(),
    globalMounts: z
      .array(z.object({ hostPath: z.string().min(1) }))
      .optional(),
  }).optional(),
  ui: z.object({
    theme: z.enum([
      "paper",
      "graphite",
      "violet-ascii",
      "terminal-glow",
      "sunrise",
      "ocean",
      "matcha",
      "rose-quartz",
      "noir",
      "amber",
    ]).optional(),
    colorMode: z.enum(["light", "dark", "system"]).optional(),
    layout: z.enum(["chat", "work"]).optional(),
    detailsDefault: z.boolean().optional(),
    lastActiveSessionId: z.string().nullable().optional(),
  }).optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  clearAiModel: z.boolean().optional(),
  fastApiKey: z.string().optional(),
  clearFastApiKey: z.boolean().optional(),
});

export const getWebState = createServerFn({ method: "GET" })
  .inputValidator(sessionInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const activeSessionId = selectSession(runtime, data.conversationId);
    return webStateDto(runtime, activeSessionId);
  });

export const createSession = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const id = crypto.randomUUID();
    const summary = runtime.sessions.ensureLogicalSession(id);
    runtime.settings.save({ ui: { lastActiveSessionId: id } });
    publishSessions(runtime);
    return sessionDto(summary);
  });

export const openSession = createServerFn({ method: "POST" })
  .inputValidator(z.object({ conversationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    runtime.sessions.ensureLogicalSession(data.conversationId);
    runtime.settings.save({ ui: { lastActiveSessionId: data.conversationId } });
    return webStateDto(runtime, data.conversationId);
  });

export const sendChatMessage = createServerFn({ method: "POST" })
  .inputValidator(sendInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    if (runtime.isShuttingDown() || runtime.isResetting()) {
      const bot = assistantMessage(
        runtime.isResetting()
          ? "Aithy is resetting. Try again in a moment."
          : "Aithy is shutting down. Try again after restart.",
      );
      return { reply: bot, activeSessionId: data.conversationId };
    }
    const text = data.text.trim();
    const user = userMessage(data.conversationId, text);
    runtime.sessions.ensureLogicalSession(data.conversationId, {
      name: generateSessionName(text),
      nameSource: "generated",
    });
    runtime.settings.save({ ui: { lastActiveSessionId: data.conversationId } });

    if (text.startsWith("/")) {
      const result = await handleSlashCommand(commandMessage(data.conversationId, text), {
        sessions: runtime.sessions,
      });
      if (result.activeConversationId) {
        runtime.settings.save({
          ui: { lastActiveSessionId: result.activeConversationId },
        });
      }
      const reply = assistantMessage(result.reply.text);
      runtime.live.publish(messageEvent(result.reply.conversationId, reply));
      publishSessions(runtime);
      return {
        reply,
        activeSessionId: result.activeConversationId ?? data.conversationId,
      };
    }

    try {
      runtime.assertReady();
      runtime.live.publish(userMessageEvent(data.conversationId, user.text, user.createdAt));
      const reply = await runtime.dispatcher.enqueueUserChat({
        conversationId: data.conversationId,
        text: user.text,
        createdAt: user.createdAt.toISOString(),
        skillIds: data.skillIds ?? [],
      });
      const bot = assistantMessage(reply.text);
      runtime.live.publish(messageEvent(reply.conversationId, bot));
      publishSessions(runtime);
      return { reply: bot, activeSessionId: data.conversationId };
    } catch (error) {
      const bot = assistantMessage(
        error instanceof Error ? `Error: ${error.message}` : "Unknown error",
      );
      runtime.live.publish(messageEvent(data.conversationId, bot));
      return { reply: bot, activeSessionId: data.conversationId };
    }
  });

export const stopChatMessage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ conversationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const stopped = runtime.activeRuns.stop(data.conversationId);
    const dropped = runtime.dispatcher.cancelByConversation(data.conversationId);
    return { stopped, queuedDropped: dropped };
  });

export const renameSession = createServerFn({ method: "POST" })
  .inputValidator(renameInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const renamed = runtime.sessions.renameSession(data.conversationId, data.name);
    publishSessions(runtime);
    return renamed ? sessionDto(renamed) : null;
  });

export const clearSession = createServerFn({ method: "POST" })
  .inputValidator(z.object({ conversationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.sessions.clear(data.conversationId);
    publishSessions(runtime);
    return webStateDto(runtime, data.conversationId);
  });

export const deleteSession = createServerFn({ method: "POST" })
  .inputValidator(z.object({ conversationId: z.string().min(1) }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const deletedIds = await runtime.sessions.deleteSession(data.conversationId);
    runtime.memoryRuns.deleteForSessions(deletedIds);
    const settings = runtime.settings.load();
    if (deletedIds.includes(settings.ui.lastActiveSessionId ?? "")) {
      runtime.settings.save({ ui: { lastActiveSessionId: null } });
    }
    publishSessions(runtime);
    return { deletedIds, sessions: runtime.sessions.listSessions().map(sessionDto) };
  });

export const deleteAllSessions = createServerFn({ method: "POST" })
  .inputValidator(confirmationInput)
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const deletedIds = await runtime.sessions.deleteAllSessions();
    runtime.memoryRuns.deleteForSessions(deletedIds);
    runtime.settings.save({ ui: { lastActiveSessionId: null } });
    publishSessions(runtime);
    return { deletedIds, sessions: [] };
  });

export const resetMemories = createServerFn({ method: "POST" })
  .inputValidator(confirmationInput)
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.memory.flushPendingEmbeds();
    runtime.memory.resetAll();
    runtime.memoryRuns.resetAll();
    return {
      memoriesCount: runtime.memory.count(),
      memoryRuns: runtime.memoryRuns.recent(50).map(memoryRunDto),
    };
  });

export const resetSystemOptions = createServerFn({ method: "POST" })
  .inputValidator(confirmationInput)
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await resetAithyRuntimeSystem();
    const id = crypto.randomUUID();
    runtime.sessions.ensureLogicalSession(id);
    runtime.settings.save({ ui: { lastActiveSessionId: id } });
    publishSessions(runtime);
    return webStateDto(runtime, id);
  });

export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator(settingsInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const provider = data.runtime?.aiProvider?.trim() || runtime.config.aiProvider;
    const apiKey = normalizePostedSecret(data.apiKey);
    const fastProvider = data.runtime?.fastAiProvider?.trim();
    const fastApiKey = normalizePostedSecret(data.fastApiKey);

    let runtimePatch = data.runtime;
    if (apiKey && !data.clearApiKey) {
      runtimePatch = { ...(runtimePatch ?? {}), aiApiKey: undefined };
    }
    if (data.clearApiKey) {
      runtimePatch = { ...(runtimePatch ?? {}), aiApiKey: null };
    }
    if (data.clearAiModel) {
      runtimePatch = { ...(runtimePatch ?? {}), aiModel: null };
    }
    await assertPrimaryAiSettings(runtime.config, { ...data, runtime: runtimePatch });
    let skippedPaths: string[] = [];
    if (runtimePatch?.globalMounts) {
      const result = await prepareGlobalMounts(
        runtimePatch.globalMounts,
        runtime.config.workspaceRoot,
      );
      runtimePatch = { ...runtimePatch, globalMounts: result.mounts };
      skippedPaths = result.skippedPaths;
    }
    if (apiKey) await writeProviderApiKey(provider, apiKey, runtime.config.botId);
    if (data.clearApiKey) await deleteProviderApiKey(provider, runtime.config.botId);
    if (fastProvider && fastApiKey) await writeProviderApiKey(fastProvider, fastApiKey, runtime.config.botId);
    if (data.clearFastApiKey && fastProvider) await deleteProviderApiKey(fastProvider, runtime.config.botId);

    const settings = await runtime.updateSettings(
      { runtime: runtimePatch, ui: data.ui },
      { apiKey, fastApiKey },
    );
    return {
      settings,
      config: configDto(runtime.config),
      secret: await secretStatus(runtime.config, settings),
      fastSecret: runtime.config.fastAiProvider
        ? runtime.config.fastAiProvider === runtime.config.aiProvider
          ? await secretStatus(runtime.config, settings)
          : await secretStatusForProvider(runtime.config.fastAiProvider, runtime.config.botId)
        : null,
      aiConfigured: isAiConfigured(runtime.config),
      skippedPaths,
    };
  });

async function prepareGlobalMounts(
  input: Array<{ hostPath: string }>,
  workspaceRoot: string,
): Promise<{ mounts: Array<{ hostPath: string }>; skippedPaths: string[] }> {
  const seen = new Set<string>();
  const out: Array<{ hostPath: string }> = [];
  const skippedPaths: string[] = [];
  const normWorkspace = path.resolve(workspaceRoot);
  for (const entry of input) {
    const raw = entry.hostPath.trim();
    if (!raw) continue;
    const expanded = expandHome(raw);
    if (!path.isAbsolute(expanded)) {
      throw new Error(`Mount path must be absolute: ${raw}`);
    }
    const resolved = path.resolve(expanded);
    if (resolved === "/workspace" || resolved === "/cache") {
      throw new Error(`Cannot mount reserved path: ${resolved}`);
    }
    const rel = path.relative(normWorkspace, resolved);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      throw new Error(`Cannot mount a path inside the workspace root: ${resolved}`);
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({ hostPath: resolved });
    try {
      await stat(resolved);
    } catch {
      skippedPaths.push(resolved);
    }
  }
  return { mounts: out, skippedPaths };
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

const soulInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  coreNature: z.string().max(4000),
  communicationStyle: z.string().max(4000),
  behaviour: z.string().max(4000),
  negativeBehavior: z.string().max(4000),
});

export const saveSoul = createServerFn({ method: "POST" })
  .inputValidator(soulInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const profile = runtime.updateSoul({
      name: data.name.trim(),
      description: data.description.trim(),
      coreNature: data.coreNature.trim(),
      communicationStyle: data.communicationStyle.trim(),
      behaviour: data.behaviour.trim(),
      negativeBehavior: data.negativeBehavior.trim(),
    });
    return soulDto(profile);
  });


export const getChildSessions = createServerFn({ method: "GET" })
  .inputValidator(z.object({ parentSessionId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    return runtime.sessions.listChildSessions(data.parentSessionId).map(sessionDto);
  });

export const listMemoryRuns = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return runtime.memoryRuns.recent(50).map(memoryRunDto);
  });

export const listNotifications = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return {
      notifications: runtime.notifications.recent(5).map(notificationDto),
      unread: runtime.notifications.unreadCount(),
    };
  });

const notificationIdInput = z.object({ id: z.number().int().positive() });

export const markNotificationRead = createServerFn({ method: "POST" })
  .inputValidator(notificationIdInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    runtime.notifications.markRead(data.id);
    return { unread: runtime.notifications.unreadCount() };
  });

export const markAllNotificationsRead = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const cleared = runtime.notifications.markAllRead();
    return { cleared, unread: runtime.notifications.unreadCount() };
  });

export const runMemoryConsolidate = createServerFn({ method: "POST" })
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.memoryConsolidate.runNow();
    return { queued: true };
  });

const usageInput = z.object({ days: z.number().int().min(1).max(365).optional() });

export const getUsageStats = createServerFn({ method: "GET" })
  .inputValidator(usageInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    return {
      buckets: runtime.usage.byDay(data.days ?? 30).map(usageBucketDto),
      totals: runtime.usage.totals(),
    };
  });

function selectSession(
  runtime: Awaited<ReturnType<typeof getAithyRuntime>>,
  requested?: string,
): string | null {
  if (!requested) return null;
  const id = requested;
  runtime.sessions.ensureLogicalSession(id);
  runtime.settings.save({ ui: { lastActiveSessionId: id } });
  return id;
}

function publishSessions(runtime: Awaited<ReturnType<typeof getAithyRuntime>>): void {
  runtime.live.publish({
    type: "sessions",
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sessions: runtime.sessions.listSessions().map(sessionDto),
  });
}

function userMessage(conversationId: string, text: string): ChannelMessage {
  return {
    id: crypto.randomUUID(),
    channelId: "web",
    conversationId,
    senderId: "local-user",
    text,
    createdAt: new Date(),
  };
}

function commandMessage(conversationId: string, text: string): ChannelCommand {
  return {
    ...userMessage(conversationId, text),
    kind: "command",
  };
}

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    kind: "text" as const,
    content: text,
    createdAt: new Date().toISOString(),
  };
}
