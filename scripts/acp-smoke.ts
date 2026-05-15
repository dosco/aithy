import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const prompt = process.env.AITHY_ACP_SMOKE_PROMPT?.trim() || "/help";
const stateDir = await mkdtemp(path.join(tmpdir(), "aithy-acp-smoke-"));
const child = spawn(process.execPath, ["run", "acp"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    AITHY_BOT_ID: "acp-smoke",
    AITHY_STATE_DIR: stateDir,
    AITHY_SANDBOX_PROVIDER: "disabled",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

const updates: string[] = [];
const stream = acp.ndJsonStream(
  Writable.toWeb(child.stdin),
  Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
);
const client = new acp.ClientSideConnection(() => ({
  async requestPermission() {
    return { outcome: { outcome: "cancelled" } };
  },
  async sessionUpdate(params) {
    const update = params.update;
    if (
      update.sessionUpdate === "agent_message_chunk"
      && update.content.type === "text"
    ) {
      updates.push(update.content.text);
    }
  },
  async readTextFile() {
    return { content: "" };
  },
  async writeTextFile() {
    return {};
  },
}), stream);

try {
  const initialized = await client.initialize({
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: {},
  });
  const session = await client.newSession({
    cwd: process.cwd(),
    mcpServers: [],
  });
  const result = await client.prompt({
    sessionId: session.sessionId,
    prompt: [{ type: "text", text: prompt }],
  });
  if (result.stopReason !== "end_turn") {
    throw new Error(`Unexpected stop reason: ${result.stopReason}`);
  }
  if (updates.length === 0) {
    throw new Error("ACP smoke did not receive assistant text");
  }
  console.log(JSON.stringify({
    protocolVersion: initialized.protocolVersion,
    sessionId: session.sessionId,
    stopReason: result.stopReason,
    assistantText: updates.join(""),
  }, null, 2));
} finally {
  child.kill();
  await rm(stateDir, { recursive: true, force: true });
  if (stderr.trim()) process.stderr.write(stderr);
}
