import { describe, expect, test } from "bun:test";
import { actorDescriptionForSandbox, createAithyAgent } from "../src/agent/create-agent";
import { EventBus } from "../src/events/bus";

describe("createAithyAgent", () => {
  test("constructs an Ax v20 agent with inline functions", () => {
    const created = createAithyAgent({
      config: {
        aiProvider: "openai",
        aiApiKey: "sk-test",
        sandboxProvider: "disabled",
        sandboxImage: "python:3.11-slim",
        sandboxCpus: 1,
        sandboxMemoryMb: 512,
        sandboxNetwork: "none",
        sessionTtlMs: 1000,
        idleParkMs: 60_000,
        maxLiveSandboxes: 8,
        workspaceRoot: "/tmp/aithy-create-agent-test",
        botId: "default",
        stateDir: "/tmp/aithy-state",
        stateDbPath: "/tmp/aithy-state/default/state.db",
        traceEnabled: false,
        tracesDir: "/tmp/aithy-state/default/traces",
        globalMounts: [],
      },
      soul: {
        name: "aithy",
        description: "A precise helper.",
        coreNature: "",
        communicationStyle: "",
        behaviour: "",
        negativeBehavior: "",
        responderDescription: "Speak with warm precision.",
        updatedAt: "2026-05-02T12:00:00.000Z",
      },
      tools: [],
      events: new EventBus(),
      conversationId: "probe",
    });

    expect(typeof created.program.forward).toBe("function");
    expect(typeof created.program.getState).toBe("function");
    expect(responderDescription(created.program)).toContain("Speak with warm precision.");
  });

  test("uses a local Bun Shell actor prompt for disabled sandbox mode", () => {
    const description = actorDescriptionForSandbox(configFixture("disabled"));

    expect(description).toContain("Bun Shell");
    expect(description).not.toContain("microVM");
    expect(description).not.toContain("/cache");
    expect(description).not.toContain("Mounting policy");
    expect(description).not.toContain("mount");
  });

  test("uses the microVM actor prompt for microsandbox mode", () => {
    const description = actorDescriptionForSandbox(configFixture("microsandbox"));

    expect(description).toContain("Linux microVM");
    expect(description).toContain("Mounting policy");
  });
});

function configFixture(sandboxProvider: "microsandbox" | "disabled") {
  return {
    aiProvider: "openai",
    aiApiKey: "sk-test",
    sandboxProvider,
    sandboxImage: "python:3.11-slim",
    sandboxCpus: 1,
    sandboxMemoryMb: 512,
    sandboxNetwork: "none" as const,
    sessionTtlMs: 1000,
    idleParkMs: 60_000,
    maxLiveSandboxes: 8,
    workspaceRoot: "/tmp/aithy-create-agent-test",
    botId: "default",
    stateDir: "/tmp/aithy-state",
    stateDbPath: "/tmp/aithy-state/default/state.db",
    traceEnabled: false,
    tracesDir: "/tmp/aithy-state/default/traces",
    globalMounts: [],
  };
}

function responderDescription(program: any): string {
  return program.responder.program.getSignature().getDescription();
}
