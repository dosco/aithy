import { describe, expect, test } from "bun:test";
import {
  LocalInferenceRecovery,
  restartDelayMs,
  type RecoveryScheduler,
} from "../src/runtime/services/local-inference/recovery";

describe("local inference recovery", () => {
  test("delay sequence caps at 30s", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(restartDelayMs)).toEqual([
      1_000,
      2_000,
      4_000,
      8_000,
      16_000,
      30_000,
      30_000,
    ]);
  });

  test("successful ready resets attempts", () => {
    const fake = fakeScheduler();
    const recovery = new LocalInferenceRecovery(fake.scheduler);
    recovery.schedule(() => {});
    expect(recovery.schedule(() => {})).toEqual({ restartAttempt: 2, restartInMs: 2_000 });

    recovery.reset();

    expect(recovery.schedule(() => {})).toEqual({ restartAttempt: 1, restartInMs: 1_000 });
  });

  test("manual reload cancels pending retry and runs immediately", () => {
    const fake = fakeScheduler();
    const recovery = new LocalInferenceRecovery(fake.scheduler);
    let retryCount = 0;
    let manualCount = 0;

    recovery.schedule(() => {
      retryCount += 1;
    });
    recovery.runNow(() => {
      manualCount += 1;
    });
    fake.runAll();

    expect(manualCount).toBe(1);
    expect(retryCount).toBe(0);
  });

  test("shutdown prevents future retries", () => {
    const fake = fakeScheduler();
    const recovery = new LocalInferenceRecovery(fake.scheduler);
    let retryCount = 0;

    recovery.schedule(() => {
      retryCount += 1;
    });
    recovery.shutdown();
    fake.runAll();

    expect(retryCount).toBe(0);
    expect(recovery.schedule(() => {
      retryCount += 1;
    })).toBeNull();
    expect(retryCount).toBe(0);
  });
});

function fakeScheduler() {
  type FakeTimer = { callback: () => void; canceled: boolean; unref: () => void };
  const timers: FakeTimer[] = [];
  let now = 0;
  const scheduler: RecoveryScheduler = {
    now: () => now,
    setTimeout: (callback) => {
      const timer = { callback, canceled: false, unref: () => {} };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      (timer as FakeTimer).canceled = true;
    },
  };
  return {
    scheduler,
    advance(ms: number) {
      now += ms;
    },
    runAll() {
      for (const timer of timers) {
        if (!timer.canceled) timer.callback();
      }
    },
  };
}
