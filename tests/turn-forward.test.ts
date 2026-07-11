import { AxAgentClarificationError, AxAIServiceAbortedError } from "@ax-llm/ax";
import { describe, expect, test } from "bun:test";
import { forwardTurn } from "../src/agent/turn-forward";

describe("forwardTurn", () => {
  test("concatenates streaming response deltas and flushes the final buffer", async () => {
    const deltas: Array<{ text: string; reset?: boolean }> = [];
    const result = await forwardTurn({
      program: programWithStream([
        { version: 1, delta: { agentResponse: "Hello" } },
        { version: 1, delta: { agentResponse: " world" } },
      ]),
      llm: {},
      values: {},
      onDelta: (delta) => deltas.push(delta),
    });

    expect(result.agentResponse).toBe("Hello world");
    expect(deltas).toEqual([{ text: "Hello world" }]);
  });

  test("resets accumulated output when Ax advances the stream version", async () => {
    const deltas: Array<{ text: string; reset?: boolean }> = [];
    const result = await forwardTurn({
      program: programWithStream([
        { version: 1, delta: { agentResponse: "bad draft" } },
        { version: 2, delta: { agentResponse: "fixed" } },
        { version: 2, delta: { agentResponse: " answer" } },
      ]),
      llm: {},
      values: {},
      onDelta: (delta) => deltas.push(delta),
    });

    expect(result.agentResponse).toBe("fixed answer");
    expect(deltas).toEqual([
      { text: "fixed", reset: true },
      { text: " answer" },
    ]);
  });

  test("falls back only when streaming throws before an agent response delta", async () => {
    let forwards = 0;
    const program = {
      forward: async () => {
        forwards += 1;
        return { agentResponse: "fallback" };
      },
      async *streamingForward() {
        throw new Error("stream unavailable");
      },
    };
    expect((await forwardTurn({ program, llm: {}, values: {} })).agentResponse).toBe("fallback");
    expect(forwards).toBe(1);
  });

  test("propagates errors raised after streaming starts", async () => {
    const program = {
      forward: async () => ({ agentResponse: "must not run" }),
      async *streamingForward() {
        yield { version: 1, index: 0, delta: { agentResponse: "partial" } };
        throw new Error("mid-stream failure");
      },
    };
    await expect(forwardTurn({ program, llm: {}, values: {} })).rejects.toThrow("mid-stream failure");
  });

  test.each([
    new AxAgentClarificationError("Which one?"),
    new AxAIServiceAbortedError("https://example.test", "cancelled"),
    Object.assign(new Error("cancelled"), { name: "AbortError" }),
  ])("propagates pre-delta clarification and abort errors without fallback", async (streamError) => {
    let forwards = 0;
    const program = {
      forward: async () => {
        forwards += 1;
        return { agentResponse: "must not run" };
      },
      async *streamingForward() {
        throw streamError;
      },
    };
    await expect(forwardTurn({ program, llm: {}, values: {} })).rejects.toBe(streamError);
    expect(forwards).toBe(0);
  });
});

function programWithStream(chunks: Array<{ version: number; delta: { agentResponse: string } }>) {
  return {
    forward: async () => ({ agentResponse: "fallback" }),
    async *streamingForward() {
      for (const [index, chunk] of chunks.entries()) yield { index, ...chunk };
    },
  };
}
