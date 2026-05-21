#!/usr/bin/env bun
/**
 * Remove Aithy state for one bot namespace or for every bot namespace.
 *
 * Usage:
 *   bun run fresh-start [<bot id>]
 *   bun run fresh-start --all
 */
import path from "node:path";
import { rm, readdir } from "node:fs/promises";
import { loadConfig } from "../src/config/env";
import { removeBotStateDir, removeMicrosandboxVm } from "../src/runtime/reset-files";

const baseConfig = loadConfig();
const target = parseTarget(normalizeArgs(process.argv.slice(2)), baseConfig.botId);

if (target.kind === "help") {
  console.log("Usage: bun run fresh-start [<bot id>]\n       bun run fresh-start --all");
  process.exit(0);
}
if (target.kind === "error") {
  console.error(target.message);
  console.log("Usage: bun run fresh-start [<bot id>]\n       bun run fresh-start --all");
  process.exit(2);
}

if (target.kind === "all") {
  const botIds = await listBotIds(baseConfig.stateDir);
  for (const botId of botIds) {
    await removeMicrosandboxVm(botId);
  }
  await rm(baseConfig.stateDir, { force: true, recursive: true });
  console.log(`Removed Aithy state root: ${baseConfig.stateDir}`);
} else {
  const botStateDir = path.join(baseConfig.stateDir, target.botId);
  await removeMicrosandboxVm(target.botId);
  await removeBotStateDir(baseConfig.stateDir, target.botId);
  console.log(`Removed Aithy state: ${botStateDir}`);
}

function normalizeArgs(args: string[]): string[] {
  const filtered = args.filter((arg) => arg !== "--");
  if (filtered[0] === "run" && filtered[1] === "fresh-start") return filtered.slice(2);
  if (filtered[0] === "fresh-start") return filtered.slice(1);
  if (filtered[0]?.endsWith("/scripts/fresh-start.ts") || filtered[0]?.endsWith("\\scripts\\fresh-start.ts")) return filtered.slice(1);
  return filtered;
}

function parseTarget(args: string[], defaultBotId: string):
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "all" }
  | { kind: "bot"; botId: string } {
  if (args[0] === "-h" || args[0] === "--help") return { kind: "help" };
  if (args[0] === "--all") {
    if (args.length > 1) return { kind: "error", message: `Unknown argument: ${args[1]}` };
    return { kind: "all" };
  }
  if (args.length > 1) return { kind: "error", message: `Unknown argument: ${args[1]}` };
  return { kind: "bot", botId: args[0] ?? defaultBotId };
}

async function listBotIds(stateDir: string): Promise<string[]> {
  try {
    const entries = await readdir(stateDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}
