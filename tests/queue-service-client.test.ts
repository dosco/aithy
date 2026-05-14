import { describe, expect, test } from "bun:test";
import {
  QueueServiceClient,
  QueueServiceConnectionClosedError,
} from "../src/runtime/services/queue/client";
import type { RuntimeServiceRole } from "../src/runtime/protocol/types";

describe("QueueServiceClient", () => {
  test("drops best-effort telemetry when the queue closes during shutdown", async () => {
    const client = queueClientForTest();

    const pendingHeartbeat = client.heartbeat("agent-worker", "stopping");
    client.beginShutdown();
    closeClientForTest(client);

    await expect(pendingHeartbeat).resolves.toBeUndefined();
  });

  test("still rejects state requests when the queue closes outside shutdown", async () => {
    const client = queueClientForTest();

    const pendingList = client.listSessions();
    closeClientForTest(client);

    await expect(pendingList).rejects.toThrow("queue-service connection closed");
  });
});

function queueClientForTest(role: RuntimeServiceRole = "agent-worker"): QueueServiceClient {
  const ctor = QueueServiceClient as unknown as {
    new(socket: WebSocket, role: RuntimeServiceRole, requestTimeoutMs: number): QueueServiceClient;
  };
  return new ctor(new FakeSocket() as unknown as WebSocket, role, 1_000);
}

function closeClientForTest(client: QueueServiceClient): void {
  const testClient = client as unknown as { markClosed(error: Error): void };
  testClient.markClosed(new QueueServiceConnectionClosedError());
}

class FakeSocket {
  readonly readyState = WebSocket.OPEN;

  send(): void {}

  close(): void {}
}
