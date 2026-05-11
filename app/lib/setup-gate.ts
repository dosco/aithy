import {
  saveSettings,
} from "@/server/actions.functions";
import { getSetupGateState } from "@/server/state.functions";
import type { SetupGateStateDto } from "@/server/dto";

let cachedGateState: SetupGateStateDto | null = null;
let pendingGateState: Promise<SetupGateStateDto> | null = null;
let gateStateVersion = 0;

export async function readSetupGateState(): Promise<SetupGateStateDto> {
  if (typeof window === "undefined") return getSetupGateState();
  if (cachedGateState) return cachedGateState;
  const requestVersion = gateStateVersion;
  pendingGateState ??= getSetupGateState()
    .then((state) => {
      if (requestVersion === gateStateVersion) cachedGateState = state;
      return state;
    })
    .finally(() => {
      pendingGateState = null;
    });
  return pendingGateState;
}

export function setCachedSetupGateState(state: SetupGateStateDto): void {
  gateStateVersion += 1;
  cachedGateState = state;
  pendingGateState = null;
}

export async function saveSettingsWithSetupGateRefresh(
  input: Parameters<typeof saveSettings>[0],
): ReturnType<typeof saveSettings> {
  const result = await saveSettings(input);
  setCachedSetupGateState({
    aiConfigured: result.aiConfigured,
    profileConfigured: cachedGateState?.profileConfigured ?? true,
  });
  return result;
}
