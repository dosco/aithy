import type { AppConfig } from "../../config/env";
import type { ToolContext } from "../tool-context";
import { createMemoryTools } from "./memory-tools";
import { createMountTools } from "./mount-tools";
import { createSandboxTools } from "./sandbox-tools";
import { createWebScrapeTools } from "./web-scrape-tool";

export function createAgentTools(ctx: ToolContext, config: AppConfig) {
  const tools = [
    ...createSandboxTools(ctx, config.sandboxProvider),
    ...createWebScrapeTools(ctx, config),
    ...createMemoryTools(ctx),
  ];
  if (config.sandboxProvider === "microsandbox") {
    tools.splice(2, 0, ...createMountTools(ctx));
  }
  return tools;
}
