import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config/env";
import { LOCAL_AI_PROVIDER, LOCAL_CHAT_MODEL_ALIAS } from "../src/local-inference/manifest";
import { captureProgramUsage, usageAttributionForConfig } from "../src/usage/capture";

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
              tokens: {
                promptTokens: 3,
                completionTokens: 2,
                cacheCreationTokens: 1,
                cacheReadTokens: 2,
                totalTokens: 5,
              },
            },
          ],
          responder: [
            {
              ai: "openai",
              model: "gpt-test-fast",
              tokens: { promptTokens: 1, completionTokens: 4, reasoningTokens: 2 },
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
        component: "chat.actor",
        stage: null,
        inputTokens: 3,
        outputTokens: 2,
        thoughtTokens: 0,
        cacheCreationTokens: 1,
        cacheReadTokens: 2,
        totalTokens: 5,
      },
      {
        provider: "openai",
        model: "gpt-test-fast",
        component: "chat.responder",
        stage: null,
        inputTokens: 1,
        outputTokens: 4,
        thoughtTokens: 2,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 7,
      },
    ]);
  });

  test("records configured local provider instead of OpenAI-compatible backend", () => {
    const records: any[] = [];
    const config = {
      ...loadConfig({}),
      aiProvider: LOCAL_AI_PROVIDER,
      aiModel: LOCAL_CHAT_MODEL_ALIAS,
    };

    captureProgramUsage(
      {
        getUsage: () => [
          {
            ai: "OpenAI",
            model: LOCAL_CHAT_MODEL_ALIAS,
            tokens: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
          },
        ],
      },
      {
        store: { record: (entry: unknown) => records.push(entry) } as any,
        purpose: "chat",
        attribution: usageAttributionForConfig(config),
      },
    );

    expect(records).toMatchObject([
      {
        provider: LOCAL_AI_PROVIDER,
        model: LOCAL_CHAT_MODEL_ALIAS,
        totalTokens: 5,
      },
    ]);
  });

  test("captures staged Ax agent usage with component labels", () => {
    const records: any[] = [];

    captureProgramUsage(
      {
        getUsage: () => [],
        getStagedUsage: () => ({
          ctx: {
            actor: [
              { ai: "openai", model: "gpt-context", tokens: { promptTokens: 2, completionTokens: 3 } },
            ],
            responder: [],
          },
          task: {
            actor: [],
            responder: [
              { ai: "openai", model: "gpt-final", tokens: { promptTokens: 5, completionTokens: 7 } },
            ],
          },
        }),
      },
      {
        store: { record: (entry: unknown) => records.push(entry) } as any,
        purpose: "chat",
      },
    );

    expect(records).toMatchObject([
      {
        model: "gpt-context",
        component: "chat.actor",
        stage: "ctx",
        totalTokens: 5,
      },
      {
        model: "gpt-final",
        component: "chat.responder",
        stage: "task",
        totalTokens: 12,
      },
    ]);
  });
});
