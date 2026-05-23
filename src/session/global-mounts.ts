import { existsSync, realpathSync, statSync } from "node:fs";
import type { ActiveRunRegistry } from "../agent/active-runs";
import type { GlobalMount } from "../config/env";
import type { EventBus } from "../events/bus";
import type { SessionMount } from "../sandbox/provider";
import type { BotSession } from "./types";
import { computeMountName } from "./session-summary";

export interface AddGlobalMountResult {
  alreadyExisted: boolean;
  mount: SessionMount;
  sandboxPath: string;
}

export function mountsForSandbox(globalMounts: readonly GlobalMount[]): SessionMount[] {
  const out: SessionMount[] = [];
  const seen = new Set<string>();
  for (const m of globalMounts) {
    if (!existsSync(m.hostPath)) continue;
    let resolved: string;
    try {
      resolved = realpathSync(m.hostPath);
      if (!statSync(resolved).isDirectory()) continue;
    } catch {
      continue;
    }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({ hostPath: resolved, mountName: computeMountName(resolved) });
  }
  return out;
}

export function prepareGlobalMountAdd(
  globalMounts: readonly GlobalMount[],
  hostPath: string,
): { result: AddGlobalMountResult; next: GlobalMount[] | null } {
  const mountName = computeMountName(hostPath);
  const sandboxPath = `/mounts/${mountName}`;
  if (globalMounts.some((m) => m.hostPath === hostPath)) {
    return {
      result: { alreadyExisted: true, mount: { hostPath, mountName }, sandboxPath },
      next: null,
    };
  }
  return {
    result: { alreadyExisted: false, mount: { hostPath, mountName }, sandboxPath },
    next: [...globalMounts, { hostPath }],
  };
}

export async function scheduleMountsRefresh(input: {
  activeRuns?: ActiveRunRegistry;
  sessions: Map<string, BotSession>;
  events: EventBus;
  botId: string;
  callerConversationId?: string;
  refresh: (conversationId?: string) => Promise<void>;
}): Promise<void> {
  const { activeRuns, sessions, callerConversationId } = input;
  const someoneIsRunning = activeRuns
    ? [...sessions.keys()].some((id) => id !== callerConversationId && activeRuns.isActive(id))
    : false;
  if (!someoneIsRunning || !activeRuns) {
    await input.refresh(callerConversationId);
    return;
  }

  input.events.emit({
    type: "sandbox.mountsRefreshPending",
    conversationId: callerConversationId ?? input.botId,
  });
  const pendingFor = [...sessions.keys()].filter(
    (id) => id !== callerConversationId && activeRuns.isActive(id),
  );
  let pending = pendingFor.length;
  for (const id of pendingFor) {
    activeRuns.onIdle(id, () => {
      pending -= 1;
      if (pending === 0) void input.refresh(callerConversationId);
    });
  }
}
