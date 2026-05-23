import path from "node:path";
import type { RuntimeServicePlacement, RuntimeServiceRole } from "./protocol/types";

export type RuntimeTopologyKind = "dev" | "packaged";

export interface RuntimeTopologyConfig {
  kind: RuntimeTopologyKind;
  serviceScriptRoot?: string;
}

export interface RuntimeTopology {
  kind: RuntimeTopologyKind;
  queuePlacement: RuntimeServicePlacement;
  agentPlacement: RuntimeServicePlacement;
  serviceScriptRoot?: string;
}

let configuredTopology: RuntimeTopologyConfig | undefined;

export function configureRuntimeTopology(config: RuntimeTopologyConfig): void {
  configuredTopology = {
    ...config,
    serviceScriptRoot: config.serviceScriptRoot ? path.resolve(config.serviceScriptRoot) : undefined,
  };
}

export function currentRuntimeTopology(): RuntimeTopology {
  return runtimeTopologyForConfig(configuredTopology);
}

export function runtimeTopologyForConfig(config: RuntimeTopologyConfig | undefined): RuntimeTopology {
  if (config?.kind === "packaged") {
    return {
      kind: "packaged",
      queuePlacement: "coordinator",
      agentPlacement: "coordinator",
      serviceScriptRoot: config.serviceScriptRoot,
    };
  }
  return {
    kind: "dev",
    queuePlacement: "process",
    agentPlacement: "process",
  };
}

export function servicePlacementDetail(
  role: RuntimeServiceRole,
  placement: RuntimeServicePlacement,
  detail: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...detail, role, placement };
}
