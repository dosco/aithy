import { describe, expect, test } from "bun:test";
import { nativeExternalImports, packagePlanForTarget, supportedReleaseTargets } from "../scripts/package-release";

describe("release package plan", () => {
  test("publishes only supported portable targets", () => {
    expect(supportedReleaseTargets()).toEqual([
      "darwin-arm64",
      "linux-x64-gnu",
      "linux-arm64-gnu",
    ]);
  });

  test("keeps queue and agent inside the coordinator archive", () => {
    const plan = packagePlanForTarget("darwin-arm64");
    expect(plan.workerEntrypoints).toEqual([
      "app/workers/sandbox-worker.js",
      "app/workers/local-inference-worker.js",
    ]);
    expect(plan.workerEntrypoints.join("\n")).not.toContain("agent-worker");
    expect(plan.workerEntrypoints.join("\n")).not.toContain("queue-service");
    expect(plan.excludedServices).toEqual(["queue-service", "agent-worker"]);
  });

  test("includes target-native vendor packages without full node_modules", () => {
    const plan = packagePlanForTarget("linux-arm64-gnu");
    expect(plan.nativePackages).toEqual([
      "sqlite-vec",
      "microsandbox",
      "sqlite-vec-linux-arm64",
      "@superradcompany/microsandbox-linux-arm64-gnu",
    ]);
  });

  test("leaves native loaders external so packaged node_modules can resolve them", () => {
    expect(nativeExternalImports()).toEqual(["sqlite-vec", "microsandbox"]);
  });
});
