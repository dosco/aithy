import { describe, expect, test } from "bun:test";
import { captureProgramUsage } from "../src/usage/capture";

describe("captureProgramUsage", () => {
  test("ignores non-iterable usage results", () => {
    const records: unknown[] = [];

    expect(() => {
      captureProgramUsage(
        {
          getUsage: () => ({}),
          resetUsage: () => records.push("reset"),
        },
        {
          store: { record: (entry: unknown) => records.push(entry) } as any,
          purpose: "chat",
          sessionId: "s1",
        },
      );
    }).not.toThrow();

    expect(records).toEqual(["reset"]);
  });

  test("captures Ax split actor and responder usage", () => {
    const records: any[] = [];

    captureProgramUsage(
      {
        getUsage: () => ({
          actor: [
            {
              ai: "openai",
              model: "gpt-test",
              tokens: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
            },
          ],
          responder: [
            {
              ai: "openai",
              model: "gpt-test-fast",
              tokens: { promptTokens: 1, completionTokens: 4, thoughtsTokens: 2 },
            },
          ],
        }),
      },
      {
        store: { record: (entry: unknown) => records.push(entry) } as any,
        purpose: "chat",
        sessionId: "s1",
      },
    );

    expect(records).toMatchObject([
      {
        provider: "openai",
        model: "gpt-test",
        inputTokens: 3,
        outputTokens: 2,
        thoughtTokens: 0,
        totalTokens: 5,
      },
      {
        provider: "openai",
        model: "gpt-test-fast",
        inputTokens: 1,
        outputTokens: 4,
        thoughtTokens: 2,
        totalTokens: 7,
      },
    ]);
  });
});
