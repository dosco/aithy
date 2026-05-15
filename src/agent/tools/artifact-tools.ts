import { f, fn } from "@ax-llm/ax";
import { argsPreview } from "../../security/capability-broker";
import type { ArtifactPublishResult } from "../../artifacts/types";
import type { ToolContext } from "../tool-context";

export function createArtifactTools(ctx: ToolContext) {
  return [createWriteTool(ctx), createPublishTool(ctx)];
}

function createWriteTool(ctx: ToolContext) {
  return fn("write")
    .namespace("artifact")
    .description("Write UTF-8 content to the current run outbox and publish it into the chat as an artifact card. Prefer this when the user asks you to create, save, write, export, or generate a text-like file for them.")
    .arg("path", f.string("Filename or path for the artifact. Bare names like cat.txt are written under the current run outbox."))
    .arg("content", f.string("Complete UTF-8 file contents to write"))
    .arg("title", f.string("Short human-readable title").optional())
    .arg("description", f.string("One-sentence description of the artifact").optional())
    .returnsField("id", f.string("Artifact id"))
    .returnsField("sessionId", f.string("Conversation id"))
    .returnsField("runId", f.string("Agent run id, or empty string"))
    .returnsField("sandboxPath", f.string("Sandbox path under the current /outbox run directory"))
    .returnsField("relativePath", f.string("Path relative to /outbox"))
    .returnsField("title", f.string("Artifact title"))
    .returnsField("description", f.string("Artifact description, or empty string"))
    .returnsField("filename", f.string("Artifact filename"))
    .returnsField("mimeType", f.string("Detected MIME type"))
    .returnsField("sizeBytes", f.number("Current file size in bytes"))
    .returnsField("previewKind", f.string("Preview kind: text, image, or download"))
    .returnsField("textPreview", f.string("Inline text preview, or empty string"))
    .returnsField("createdAt", f.string("Creation timestamp"))
    .returnsField("openUrl", f.string("Local URL for inline viewing"))
    .returnsField("downloadUrl", f.string("Local URL for downloading"))
    .handler(async ({ path, content, title, description }) => {
      if (!ctx.artifacts) throw new Error("artifact.write is unavailable without artifact storage");
      const run = artifactRunContext(ctx);
      ctx.capabilities?.require({
        conversationId: ctx.session.conversationId,
        capability: "artifact.write",
        toolName: "artifact.write",
        argsPreview: argsPreview({ path, contentBytes: content.length, title, description }),
      });
      const artifact = await ctx.artifacts.write({
        sessionId: ctx.session.conversationId,
        runId: run.runId,
        runOutboxPath: run.runOutboxPath,
        path,
        content,
        title,
        description,
      });
      return publishResultForTool(artifact);
    })
    .build();
}

function createPublishTool(ctx: ToolContext) {
  return fn("publish")
    .namespace("artifact")
    .description("Publish an existing user-facing file from the current run outbox into the chat as an artifact card. Use this after a command or tool has already created the artifact file.")
    .arg("path", f.string("Path under the current run outbox, or a path relative to it."))
    .arg("title", f.string("Short human-readable title").optional())
    .arg("description", f.string("One-sentence description of the artifact").optional())
    .returnsField("id", f.string("Artifact id"))
    .returnsField("sessionId", f.string("Conversation id"))
    .returnsField("runId", f.string("Agent run id, or empty string"))
    .returnsField("sandboxPath", f.string("Sandbox path under the current /outbox run directory"))
    .returnsField("relativePath", f.string("Path relative to /outbox"))
    .returnsField("title", f.string("Artifact title"))
    .returnsField("description", f.string("Artifact description, or empty string"))
    .returnsField("filename", f.string("Artifact filename"))
    .returnsField("mimeType", f.string("Detected MIME type"))
    .returnsField("sizeBytes", f.number("Current file size in bytes"))
    .returnsField("previewKind", f.string("Preview kind: text, image, or download"))
    .returnsField("textPreview", f.string("Inline text preview, or empty string"))
    .returnsField("createdAt", f.string("Creation timestamp"))
    .returnsField("openUrl", f.string("Local URL for inline viewing"))
    .returnsField("downloadUrl", f.string("Local URL for downloading"))
    .handler(async ({ path, title, description }) => {
      if (!ctx.artifacts) throw new Error("artifact.publish is unavailable without artifact storage");
      const run = artifactRunContext(ctx);
      ctx.capabilities?.require({
        conversationId: ctx.session.conversationId,
        capability: "artifact.publish",
        toolName: "artifact.publish",
        argsPreview: argsPreview({ path, title, description }),
      });
      const artifact = await ctx.artifacts.publish({
        sessionId: ctx.session.conversationId,
        runId: run.runId,
        runOutboxPath: run.runOutboxPath,
        path,
        title,
        description,
      });
      return publishResultForTool(artifact);
    })
    .build();
}

function publishResultForTool(artifact: ArtifactPublishResult) {
  return {
    ...artifact,
    runId: artifact.runId ?? "",
    description: artifact.description ?? "",
    textPreview: artifact.textPreview ?? "",
  };
}

function artifactRunContext(ctx: ToolContext): { runId: string; runOutboxPath: string } {
  if (!ctx.artifactRunId || !ctx.artifactRunOutboxPath) {
    throw new Error("artifact tools require a current run outbox");
  }
  return { runId: ctx.artifactRunId, runOutboxPath: ctx.artifactRunOutboxPath };
}
