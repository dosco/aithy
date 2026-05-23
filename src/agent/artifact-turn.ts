import type { SqliteArtifactStore } from "../artifacts/artifact-store";
import { artifactResultToMessage } from "../artifacts/artifact-store";
import { listRunOutboxFiles } from "../artifacts/reconcile";
import { runOutboxPath } from "../artifacts/paths";
import type { ArtifactEntry, ArtifactPublishResult } from "../artifacts/types";
import type { AssistantArtifactMessage, AssistantToolCallMessage } from "../session/types";

export interface ArtifactRunContext {
  runId: string;
  runOutboxPath: string;
  runOutboxRelativePath: string;
}

export function createArtifactRunContext(sessionId: string): ArtifactRunContext {
  const runId = crypto.randomUUID();
  const runOutbox = runOutboxPath(sessionId, runId);
  return {
    runId,
    runOutboxPath: runOutbox,
    runOutboxRelativePath: runOutbox.slice("/outbox/".length),
  };
}

export function artifactContextText(input: ArtifactRunContext, recentArtifacts: readonly ArtifactEntry[] = []): string {
  const lines = [
    `Current run id: ${input.runId}`,
    `Current run outbox: ${input.runOutboxPath}`,
    "Use the current run outbox for new user-facing files. Files created there during this turn are published as artifact cards.",
  ];
  if (recentArtifacts.length > 0) {
    lines.push("Recent current-session artifacts:");
    for (const artifact of recentArtifacts.slice(0, 10)) {
      lines.push(`- ${artifact.title}; filename=${artifact.filename}; id=${artifact.id}; sandboxPath=${artifact.sandboxPath}; openUrl=/api/artifacts/${artifact.id}`);
    }
  }
  return lines.join("\n");
}

export function artifactEnv(input: ArtifactRunContext, sessionId: string): Record<string, string> {
  return {
    AITHY_OUTBOX: input.runOutboxPath,
    AITHY_RUN_ID: input.runId,
    AITHY_SESSION_ID: sessionId,
  };
}

export function artifactIdsForRun(
  artifacts: SqliteArtifactStore | undefined,
  sessionId: string,
  runId: string,
): Set<string> {
  return new Set(artifacts?.listForRun(sessionId, runId).map((artifact) => artifact.id) ?? []);
}

export async function artifactMessagesForTurn(input: {
  artifacts?: SqliteArtifactStore;
  sessionId: string;
  run: ArtifactRunContext;
  toolMessages: readonly AssistantToolCallMessage[];
  artifactIdsBeforeTurn: ReadonlySet<string>;
}): Promise<AssistantArtifactMessage[]> {
  const fromTools = artifactMessagesFromToolCalls(input.toolMessages);
  const seen = new Set([...input.artifactIdsBeforeTurn, ...fromTools.map((message) => message.id)]);
  const reconciled = await reconcileRunOutbox(input.artifacts, input.sessionId, input.run, seen);
  return [...fromTools, ...reconciled];
}

function artifactMessagesFromToolCalls(
  messages: readonly AssistantToolCallMessage[],
): AssistantArtifactMessage[] {
  return messages.flatMap((message) => {
    if (message.toolName !== "artifact.publish" && message.toolName !== "artifact.write") return [];
    const result = message.toolResult;
    if (!result || typeof result !== "object") return [];
    const record = result as Record<string, unknown>;
    if (record.ok === false) return [];
    const artifact = artifactResultToMessage("value" in record ? record.value : record);
    return artifact ? [artifactMessageFromResult(artifact)] : [];
  });
}

async function reconcileRunOutbox(
  artifacts: SqliteArtifactStore | undefined,
  sessionId: string,
  run: ArtifactRunContext,
  seenIds: ReadonlySet<string>,
): Promise<AssistantArtifactMessage[]> {
  if (!artifacts) return [];
  const known = artifacts.listForRun(sessionId, run.runId);
  const knownPaths = new Set(known.map((artifact) => artifact.relativePath));
  const messages = known
    .filter((artifact) => !seenIds.has(artifact.id))
    .map(artifactMessageFromEntry);
  const files = await listRunOutboxFiles(artifacts.outboxRootPath(), run.runOutboxRelativePath);
  for (const outboxRelativePath of files) {
    if (knownPaths.has(outboxRelativePath)) continue;
    const runRelativePath = stripRunPrefix(run.runOutboxRelativePath, outboxRelativePath);
    if (!runRelativePath) continue;
    const artifact = await artifacts.registerRunFile({
      sessionId,
      runId: run.runId,
      runOutboxPath: run.runOutboxPath,
      relativePath: runRelativePath,
    });
    messages.push(artifactMessageFromResult(artifact));
    knownPaths.add(artifact.relativePath);
  }
  return messages;
}

function stripRunPrefix(runOutboxRelativePath: string, outboxRelativePath: string): string | null {
  const prefix = `${runOutboxRelativePath}/`;
  return outboxRelativePath.startsWith(prefix) ? outboxRelativePath.slice(prefix.length) : null;
}

function artifactMessageFromEntry(entry: ArtifactEntry): AssistantArtifactMessage {
  return {
    role: "assistant",
    kind: "artifact",
    ...withArtifactUrls(entry),
  };
}

function artifactMessageFromResult(artifact: ArtifactPublishResult): AssistantArtifactMessage {
  return {
    role: "assistant",
    kind: "artifact",
    ...artifact,
  };
}

function withArtifactUrls(entry: ArtifactEntry): ArtifactPublishResult {
  return {
    ...entry,
    openUrl: `/api/artifacts/${entry.id}`,
    downloadUrl: `/api/artifacts/${entry.id}?download=1`,
  };
}
