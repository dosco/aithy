import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SqliteSkillsStore } from "../src/skills/skills-store";
import { skillsCatalog } from "../src/skills/catalog";
import { allowedSandboxToolForEval } from "../src/skills/eval-runner";
import { SqliteSkillEvalStore, validateSkillEvals } from "../src/skills/evals";
import { parseSkillBundleFiles } from "../src/skills/bundle";
import { SkillEvalQueue } from "../src/skills/eval-queue";
import { SqliteTaskStore } from "../src/tasks/task-store";
import { EventBus } from "../src/events/bus";

describe("Skills Lab catalog and analytics", () => {
  test("eval tool allowlists never widen read or write declarations into shell access", () => {
    expect(allowedSandboxToolForEval("Read Write", "sandbox.bash")).toBe(false);
    expect(allowedSandboxToolForEval("Bash(git status:*)", "sandbox.bash")).toBe(true);
    expect(allowedSandboxToolForEval("Write", "sandbox.edit")).toBe(true);
    expect(allowedSandboxToolForEval("system.bash", "system.bash")).toBe(false);
  });
  test("memoizes a full enabled model-invocable Ax catalog for 30 seconds", async () => {
    const { store, root } = await skillStore();
    store.upsert(skill("enabled", "Enabled", { whenToUse: "When reports are requested" }));
    store.upsert(skill("hidden", "Hidden", { disableModelInvocation: true }));
    const first = skillsCatalog(store, 1_000);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ id: "enabled", name: "Enabled" });
    expect(first[0]?.description).toContain("When reports are requested");
    expect(first[0]?.content).toContain("Body for Enabled");
    store.upsert(skill("later", "Later"));
    expect(skillsCatalog(store, 20_000)).toBe(first);
    expect(skillsCatalog(store, 31_001).map((entry) => entry.id).sort()).toEqual(["enabled", "later"]);
    store.close(); await rm(root, { recursive: true, force: true });
  });

  test("sorts skills by used count then name and id with a stable cursor", async () => {
    const { store, root } = await skillStore();
    for (const name of ["Zulu", "Alpha", "Beta"]) store.upsert(skill(name.toLowerCase(), name));
    store.recordEvent({ eventType: "used", skillId: "zulu" });
    store.recordEvent({ eventType: "used", skillId: "alpha" });
    store.recordEvent({ eventType: "used", skillId: "alpha" });
    const first = store.page({ cursor: null, limit: 2, sort: "used" });
    expect(first.items.map((entry) => entry.id)).toEqual(["alpha", "zulu"]);
    expect(first.nextCursor).toMatchObject({ usedCount: 1, name: "Zulu", id: "zulu" });
    expect(store.page({ cursor: first.nextCursor, limit: 2, sort: "used" }).items.map((entry) => entry.id)).toEqual(["beta"]);
    store.close(); await rm(root, { recursive: true, force: true });
  });

  test("validates authored eval JSON and persists definitions and run results", async () => {
    const { store, root } = await skillStore();
    store.upsert(skill("tested", "Tested"));
    const definitions = validateSkillEvals([{ request: "Make a report", criteria: "Returns concise markdown" }]);
    expect(store.setEvals("tested", definitions).evals).toEqual(definitions);
    expect(() => validateSkillEvals(Array.from({ length: 6 }, () => definitions[0]))).toThrow(/at most five/);
    const runs = new SqliteSkillEvalStore(path.join(root, "state.db"));
    const run = runs.start("tested", "fast-model");
    const complete = runs.complete(run.id, [{ ...definitions[0], status: "blocked", response: "", toolCalls: [], score: null, rationale: "approval denied" }]);
    expect(complete).toMatchObject({ status: "completed", score: null });
    expect(runs.recent("tested")[0]?.cases[0]?.status).toBe("blocked");
    runs.close(); store.close(); await rm(root, { recursive: true, force: true });
  });

  test("rejects invalid eval definitions without partially updating the skill", async () => {
    const { store, root } = await skillStore();
    const original = { ...skill("atomic", "Atomic"), body: "original" };
    store.upsert(original);
    expect(() => store.upsert({
      ...original,
      body: "must not persist",
      evals: [{ request: "", criteria: "missing request" }] as never,
    })).toThrow(/requires request and criteria/);
    expect(store.get("atomic")?.body).toBe("original");
    store.close(); await rm(root, { recursive: true, force: true });
  });

  test("accepts evals as a JSON block in SKILL.md frontmatter", () => {
    const bundle = parseSkillBundleFiles([{ path: "SKILL.md", content: `---\nname: Reports\nevals: |\n  [{"request":"Build it","criteria":"Produces a report"}]\n---\nBody` }]);
    expect(bundle.evals).toEqual([{ request: "Build it", criteria: "Produces a report" }]);
  });

  test("queues skill.eval tasks and persists aggregate results", async () => {
    const { store, root } = await skillStore(); const dbPath = path.join(root, "state.db");
    store.upsert(skill("queued", "Queued")); const tasks = new SqliteTaskStore(dbPath);
    const task = tasks.create({ kind: "skill.eval", title: "Test Queued" });
    const queue = new SkillEvalQueue({ config: { stateDbPath: dbPath, aiModel: "model" } as never,
      events: new EventBus(), sessions: {} as never, sandbox: {} as never, skills: store, tasks,
      runner: { run: async () => ({ model: "model", cases: [{ request: "R", criteria: "C", response: "OK",
        toolCalls: [], score: 1, rationale: "Met", status: "passed" }] }) } });
    queue.enqueue("queued", task.id); await queue.close();
    expect(tasks.get(task.id)).toMatchObject({ status: "completed", resultSummary: "Score 1.00" });
    tasks.close(); store.close(); await rm(root, { recursive: true, force: true });
  });
});

async function skillStore() {
  const root = await mkdtemp(path.join(tmpdir(), "aithy-skills-lab-"));
  return { root, store: new SqliteSkillsStore(path.join(root, "state.db")) };
}

function skill(id: string, name: string, options: { whenToUse?: string; disableModelInvocation?: boolean } = {}) {
  return { id, name, description: `${name} description`, whenToUse: options.whenToUse ?? null, body: `Body for ${name}`,
    allowedTools: null, tags: null, disableModelInvocation: options.disableModelInvocation };
}
