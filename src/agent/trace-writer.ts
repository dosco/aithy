import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { AxChatLogEntry } from "@ax-llm/ax";
import type { AppConfig } from "../config/env";
import type { EventBus } from "../events/bus";

export interface TurnTraceChatLog {
  actor: readonly AxChatLogEntry[];
  responder: readonly AxChatLogEntry[];
}

export type TracePipeline = "actor" | "responder";
export type TraceStage = "ctx" | "task" | undefined;

export function traceFilenameFor(pipeline: TracePipeline, stage: TraceStage): string {
  if (pipeline === "actor") {
    if (stage === "ctx") return "context-explorer.jsonl";
    if (stage === "task") return "task-executor.jsonl";
    return "actor.jsonl";
  }
  if (stage === "ctx") return "context-distiller.jsonl";
  return "final-responder.jsonl";
}

export async function appendChatLogToTraces(
  config: AppConfig,
  chatLog: TurnTraceChatLog,
  events: EventBus,
): Promise<void> {
  if (chatLog.actor.length === 0 && chatLog.responder.length === 0) return;
  try {
    const grouped = new Map<string, string[]>();
    const collect = (entries: readonly AxChatLogEntry[], pipeline: TracePipeline) => {
      for (const entry of entries) {
        const file = traceFilenameFor(pipeline, entry.stage);
        const lines = grouped.get(file) ?? [];
        lines.push(JSON.stringify({ messages: entry.messages }));
        grouped.set(file, lines);
      }
    };
    collect(chatLog.actor, "actor");
    collect(chatLog.responder, "responder");
    if (grouped.size === 0) return;

    await mkdir(config.tracesDir, { recursive: true });
    for (const [file, lines] of grouped) {
      await appendFile(path.join(config.tracesDir, file), `${lines.join("\n")}\n`, "utf8");
    }
  } catch (error) {
    events.emit({
      type: "error",
      message: `trace-writer: failed to append traces in ${config.tracesDir}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      cause: error,
    });
  }
}
