import type { AppConfig } from "../config/env";
import type { SetupStatusInput } from "../setup/status";
import { DisabledSandboxProvider } from "./disabled-provider";
import { MicrosandboxProvider } from "./microsandbox-provider";
import type { SandboxProvider } from "./provider";

export function createSandboxProvider(
  config: AppConfig,
  onStatus?: (status: SetupStatusInput) => void,
): SandboxProvider {
  if (config.sandboxProvider === "disabled") return new DisabledSandboxProvider();
  return new MicrosandboxProvider({
    image: config.sandboxImage,
    cpus: config.sandboxCpus,
    memoryMb: config.sandboxMemoryMb,
    network: config.sandboxNetwork,
    onStatus,
  });
}
