import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { HOME_SESSION_ID } from "../../src/session/home-session";
import { conversationIdInput, confirmationInput, renameInput } from "./action-schemas";
import { webStateDto, sessionDto } from "./dto";

export const renameSession = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const renamed = runtime.sessions.renameSession(data.conversationId, data.name);
    await runtime.sessionState.flush();
    return renamed ? sessionDto(renamed) : null;
  });

export const clearSession = createServerFn({ method: "POST" })
  .validator(conversationIdInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.sessions.clear(data.conversationId);
    await runtime.artifacts.deleteForSessions([data.conversationId], { deleteFiles: true });
    await runtime.sessionState.flush();
    return webStateDto(runtime, data.conversationId);
  });

export const deleteSession = createServerFn({ method: "POST" })
  .validator(conversationIdInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    if (data.conversationId === HOME_SESSION_ID) {
      return { deletedIds: [], sessions: runtime.sessions.listSessions().map(sessionDto) };
    }
    await runtime.dispatcher.cancelByConversation(data.conversationId);
    const deletedIds = await runtime.sessions.deleteSession(data.conversationId);
    await runtime.sessionState.flush();
    runtime.memoryRuns.deleteForSessions(deletedIds);
    await runtime.artifacts.deleteForSessions(deletedIds, { deleteFiles: true });
    const settings = runtime.settings.load();
    if (deletedIds.includes(settings.ui.lastActiveSessionId ?? "")) {
      runtime.settings.save({ ui: { lastActiveSessionId: null } });
    }
    return { deletedIds, sessions: runtime.sessions.listSessions().map(sessionDto) };
  });

export const deleteAllSessions = createServerFn({ method: "POST" })
  .validator(confirmationInput)
  .handler(async () => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    await runtime.dispatcher.cancelAll?.("Deleting all sessions");
    const deletedIds = await runtime.sessions.deleteAllSessions();
    await runtime.sessionState.flush();
    runtime.memoryRuns.deleteForSessions(deletedIds);
    await runtime.artifacts.deleteForSessions(deletedIds, { deleteFiles: true });
    runtime.settings.save({ ui: { lastActiveSessionId: null } });
    return { deletedIds, sessions: [] };
  });

export const getChildSessions = createServerFn({ method: "GET" })
  .validator(z.object({ parentSessionId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    await runtime.sessionState.preloadAll();
    return runtime.sessions.listChildSessions(data.parentSessionId).map(sessionDto);
  });
