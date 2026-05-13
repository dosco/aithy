import { createServerFn } from "@tanstack/react-start";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import {
  memoryPageStateDto,
  notificationsPageStateDto,
  sessionsPageStateDto,
  settingsPageStateDto,
  setupGateStateDto,
  setupPageStateDto,
  skillsPageStateDto,
  themesPageStateDto,
  usagePageStateDto,
} from "./dto";

export const getSetupGateState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return setupGateStateDto(runtime);
  });

export const getSessionsPageState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return sessionsPageStateDto(runtime);
  });

export const getMemoryPageState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return memoryPageStateDto(runtime);
  });

export const getSkillsPageState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return skillsPageStateDto(runtime);
  });

export const getSettingsPageState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return settingsPageStateDto(runtime);
  });

export const getSetupPageState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return setupPageStateDto(runtime);
  });

export const getThemesPageState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return themesPageStateDto(runtime);
  });

export const getUsagePageState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return usagePageStateDto(runtime);
  });

export const getNotificationsPageState = createServerFn({ method: "GET" })
  .handler(async () => {
    const runtime = await getAithyRuntime();
    return notificationsPageStateDto(runtime);
  });
