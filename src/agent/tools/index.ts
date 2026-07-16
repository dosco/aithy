import type { AppConfig } from "../../config/env";
import type { ToolContext } from "../tool-context";
import { createArtifactTools } from "./artifact-tools";
import { createAutomationTools } from "./automation-tools";
import { createMemoryTools } from "./memory-tools";
import { createKnowledgeTools } from "./knowledge-tools";
import { createMountTools } from "./mount-tools";
import { createSandboxTools } from "./sandbox-tools";
import { createSkillTools } from "./skill-tools";
import { createSystemTools } from "./system-tools";
import { createTaskTools } from "./task-tools";
import { createWebFetchTools } from "./web-fetch-tool";
import { createWebSearchTools } from "./web-search-tool";

export function createAgentTools(ctx: ToolContext, config: AppConfig) {
  const tools = [
    ...createSandboxTools(ctx, config.sandboxProvider),
    ...(config.systemBashEnabled ? createSystemTools(ctx) : []),
    ...createWebSearchTools(ctx, config),
    ...createWebFetchTools(ctx, config),
    ...createArtifactTools(ctx),
    ...createSkillTools(ctx),
    ...createAutomationTools(ctx),
    ...createMemoryTools(ctx),
    ...createKnowledgeTools(ctx),
    ...createTaskTools(ctx),
  ];
  if (config.sandboxProvider === "microsandbox") {
    tools.splice(2, 0, ...createMountTools(ctx));
  }
  return tools;
}
