import type { SqliteUsageStore } from "../usage/usage-store";

export function recordMeshCallerUsage(
  usage: SqliteUsageStore,
  provider: string,
  body: unknown,
): void {
  const model = typeof body === "object" && body && "model" in body
    ? String((body as { model?: unknown }).model ?? "")
    : "";
  usage.record({
    provider,
    model: model || "mesh",
    purpose: "chat",
    inputTokens: 0,
    outputTokens: 0,
  });
}
