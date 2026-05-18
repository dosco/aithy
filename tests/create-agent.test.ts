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
        parallelAgents: 1,
        parallelSearchMcpUrl: "https://search.parallel.ai/mcp",
        systemBashEnabled: true,
        workspaceRoot: "/tmp/aithy-create-agent-test",
        outboxRoot: "/tmp/aithy-create-agent-test-outbox",
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
    expect(executorDescription(created.program)).toContain("Bun Shell");
    expect(responderDescription(created.program)).toContain("Speak with warm precision.");
    expect(responderDescription(created.program)).not.toContain("User Profile");
    expect(responderDescription(created.program)).not.toContain("Violet");
    expect(inputFields(created.program)[0]).toMatchObject({
      name: "userProfile",
      isCached: true,
      isOptional: true,
    });
  });

  test("uses a local Bun Shell actor prompt for disabled sandbox mode", () => {
    const description = actorDescriptionForSandbox(configFixture("disabled"));

    expect(description).toContain("Bun Shell");
    expect(description).toContain("When the user's request includes a URL");
    expect(description).toContain("call web.fetch on the URL before answering");
    expect(description).toContain("use artifact.write");
    expect(description).toContain("call artifact.publish");
    expect(description).toContain("Existing/published artifacts");
    expect(description).toContain("conversationHistory as \"Published artifact:\" lines");
    expect(description).toContain("bot-shared");
    expect(description).toContain("retrieval judged potentially relevant");
    expect(description).toContain("Treat them as optional context");
    expect(description).toContain("validity windows and evidence");
    expect(description).not.toContain("microVM");
    expect(description).not.toContain("/cache");
    expect(description).not.toContain("Mounting policy");
    expect(description).not.toContain("/mounts/");
    expect(description).not.toContain("per-session");
    expect(description).toContain("system.bash");
  });

  test("uses the microVM actor prompt for microsandbox mode", () => {
    const description = actorDescriptionForSandbox(configFixture("microsandbox"));

    expect(description).toContain("Linux microVM");
    expect(description).toContain("When the user's request includes a URL");
    expect(description).toContain("call web.fetch on the URL before answering");
    expect(description).toContain("use artifact.write");
    expect(description).toContain("call artifact.publish");
    expect(description).toContain("Existing/published artifacts");
    expect(description).toContain("conversationHistory as \"Published artifact:\" lines");
    expect(description).toContain("Mounting policy");
    // New topology: top-level /mounts/<name> + bot-shared /workspace, no /cache
    // mount, no "per-session" framing.
    expect(description).toContain("/mounts/");
    expect(description).toContain("bot-shared");
    expect(description).not.toContain("/cache");
    expect(description).not.toContain("per-session");
    expect(description).toContain("system.bash");
  });

  test("omits host shell actor prompt when system.bash is disabled", () => {
    const description = actorDescriptionForSandbox({
      ...configFixture("microsandbox"),
      systemBashEnabled: false,
    });

    expect(description).not.toContain("system.bash");
    expect(description).not.toContain("base computer outside the VM");
  });

  test("describes context distillation for resolving clarification follow-ups", () => {
    const created = createAithyAgent({
      config: configFixture("disabled"),
      tools: [],
      events: new EventBus(),
      conversationId: "probe",
    });

    const description = distillerDescription(created.program);

    expect(description).toContain("context distiller");
    expect(description).toContain("inputs.conversationHistory");
    expect(description).toContain("resolvedRequest");
    expect(description).toContain("Published artifact");
    expect(description).toContain("exact sandboxPath");
    expect(description).toContain("yes yes yes");
    expect(description).toContain("downtown Vancouver");
    expect(description).toContain("treat that URL as concrete context");
    expect(contextHistoryPromptChars(created.program)).toBe(2_000);
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
    parallelAgents: 1,
    parallelSearchMcpUrl: "https://search.parallel.ai/mcp",
    systemBashEnabled: true,
    workspaceRoot: "/tmp/aithy-create-agent-test",
    outboxRoot: "/tmp/aithy-create-agent-test-outbox",
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

function executorDescription(program: any): string {
  return program.executor._buildActorInstruction();
}

function distillerDescription(program: any): string {
  return program.distiller.options.description;
}

function contextHistoryPromptChars(program: any): number {
  return program.options.contextFields[0].keepInPromptChars;
}

function inputFields(program: any): any[] {
  return program.fullSignature.getInputFields();
}
