import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { AithyAcpAgent } from "./agent";
import { AithyRuntimeAcpBridge } from "./runtime-bridge";

export function startAithyAcpServer(): acp.AgentSideConnection {
  redirectConsoleOutputToStderr();
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(input, output);
  const bridge = new AithyRuntimeAcpBridge();
  return new acp.AgentSideConnection(
    (connection) => new AithyAcpAgent(connection, bridge),
    stream,
  );
}

if (import.meta.main) {
  const connection = startAithyAcpServer();
  await connection.closed;
}

function redirectConsoleOutputToStderr(): void {
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = (...args: unknown[]) => console.error(...args);
}
