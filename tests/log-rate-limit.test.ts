import { describe, expect, test } from "bun:test";
import { RuntimeLogRateLimiter } from "../src/runtime/log-rate-limit";

describe("RuntimeLogRateLimiter", () => {
  test("suppresses repeated info logs inside the window", () => {
    const limiter = new RuntimeLogRateLimiter(5_000);
    const input = {
      role: "local-inference-worker" as const,
      level: "info" as const,
      source: "setup",
      message: "downloading local model Qwen3 Embedding 0.6B Q8_0",
    };

    expect(limiter.shouldPublish(input, 1_000)).toBe(true);
    expect(limiter.shouldPublish(input, 1_250)).toBe(false);
    expect(limiter.shouldPublish(input, 6_250)).toBe(true);
  });

  test("keeps different log messages independent", () => {
    const limiter = new RuntimeLogRateLimiter(5_000);

    expect(limiter.shouldPublish({
      role: "local-inference-worker",
      level: "info",
      source: "setup",
      message: "downloading local model Qwen3 Embedding 0.6B Q8_0",
    }, 1_000)).toBe(true);
    expect(limiter.shouldPublish({
      role: "local-inference-worker",
      level: "info",
      source: "setup",
      message: "downloading local model Qwen3 Reranker 0.6B Q8_0",
    }, 1_250)).toBe(true);
  });

  test("does not suppress warning or error logs", () => {
    const limiter = new RuntimeLogRateLimiter(5_000);

    expect(limiter.shouldPublish({
      role: "sandbox-worker",
      level: "error",
      message: "sandbox failed",
    }, 1_000)).toBe(true);
    expect(limiter.shouldPublish({
      role: "sandbox-worker",
      level: "error",
      message: "sandbox failed",
    }, 1_250)).toBe(true);
  });
});
