import { describe, expect, test } from "bun:test";
import { RuntimeLogRateLimiter } from "../src/runtime/log-rate-limit";

describe("RuntimeLogRateLimiter", () => {
  test("suppresses repeated info logs inside the window", () => {
    const limiter = new RuntimeLogRateLimiter(5_000);
    const input = {
      role: "embedding-worker" as const,
      level: "info" as const,
      source: "setup",
      message: "downloading memory model Xenova/all-MiniLM-L6-v2",
    };

    expect(limiter.shouldPublish(input, 1_000)).toBe(true);
    expect(limiter.shouldPublish(input, 1_250)).toBe(false);
    expect(limiter.shouldPublish(input, 6_250)).toBe(true);
  });

  test("keeps different log messages independent", () => {
    const limiter = new RuntimeLogRateLimiter(5_000);

    expect(limiter.shouldPublish({
      role: "embedding-worker",
      level: "info",
      source: "setup",
      message: "downloading memory model Xenova/all-MiniLM-L6-v2",
    }, 1_000)).toBe(true);
    expect(limiter.shouldPublish({
      role: "embedding-worker",
      level: "info",
      source: "setup",
      message: "downloading reranker model Xenova/ms-marco-MiniLM-L-6-v2",
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
