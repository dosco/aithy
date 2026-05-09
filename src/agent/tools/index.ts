import type { AppConfig } from "../../config/env";
import type { ToolContext } from "../tool-context";
import { createMemoryTools } from "./memory-tools";
import { createMountTools } from "./mount-tools";
import { createSandboxTools } from "./sandbox-tools";

export function createAgentTools(ctx: ToolContext, sandboxProvider: AppConfig["sandboxProvider"]) {
  const tools = [
    ...createSandboxTools(ctx, sandboxProvider),
    ...createMemoryTools(ctx),
  ];
  if (sandboxProvider === "microsandbox") {
    tools.splice(2, 0, ...createMountTools(ctx));
  }
  return tools;
}
