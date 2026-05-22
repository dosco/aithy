import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteSkillsStore, formatSkillContent } from "../src/skills/skills-store";
import { seedSkillsIfEmpty } from "../src/skills/seed";
import { diffSkillBundle, parseSkillBundleFiles } from "../src/skills/bundle";
import { MockEmbedder } from "./embed-mock";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-skills-"));
  return path.join(dir, "state.db");
}

describe("SqliteSkillsStore", () => {
  test("upserts and lists skills with allowed_tools and tags", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "pdf-tool",
      name: "pdf-tool",
      description: "PDF to markdown.",
      body: "# PDF Tool\n\n## Examples\n\nUse docling.",
      allowedTools: "Bash(docling:*) Read",
      tags: "pdf docling document",
    });
    store.upsert({
      id: "shell-helper",
      name: "shell-helper",
      description: "Shell tips.",
      body: "Quote your variables.",
      allowedTools: null,
      tags: "bash sandbox",
    });

    const all = store.getAll();
    expect(all.map((s) => s.name)).toEqual(["pdf-tool", "shell-helper"]);

    const pdf = all[0];
    expect(pdf.allowed_tools).toBe("Bash(docling:*) Read");
    expect(pdf.tags).toBe("pdf docling document");
    expect(pdf.retrieved_count).toBe(0);
    expect(pdf.body).toContain("#### PDF Tool");
    expect(pdf.body).toContain("##### Examples");
    expect(pdf.body).not.toMatch(/^#{1,3}\s/m);
  });

  test("delete removes a row", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "a",
      name: "a",
      description: "",
      body: "",
      allowedTools: null,
      tags: null,
    });
    expect(store.delete("a")).toBe(true);
    expect(store.delete("a")).toBe(false);
    expect(store.getAll()).toHaveLength(0);
  });

  test("upsert updates an existing row by id", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "alpha",
      name: "alpha",
      description: "first",
      body: "first body",
      allowedTools: null,
      tags: null,
    });
    store.upsert({
      id: "alpha",
      name: "alpha-renamed",
      description: "second",
      body: "second body",
      allowedTools: "Read",
      tags: "x",
    });
    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("alpha-renamed");
    expect(all[0].description).toBe("second");
    expect(all[0].allowed_tools).toBe("Read");
  });

  test("tracks skill retrieval and preserves counts across edits", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "alpha",
      name: "alpha",
      description: "",
      body: "",
      allowedTools: null,
      tags: null,
    });
    store.upsert({
      id: "bravo",
      name: "bravo",
      description: "",
      body: "",
      allowedTools: null,
      tags: null,
    });

    store.incrementRetrieved(["bravo", "missing", "bravo"]);
    store.incrementRetrieved(["alpha"]);

    expect(store.get("bravo")?.retrieved_count).toBe(1);
    expect(store.topRetrieved(2).map((s) => s.id)).toEqual(["alpha", "bravo"]);

    store.incrementRetrieved(["bravo"]);
    expect(store.topRetrieved(2).map((s) => s.id)).toEqual(["bravo", "alpha"]);

    store.upsert({
      id: "bravo",
      name: "bravo-renamed",
      description: "updated",
      body: "",
      allowedTools: null,
      tags: null,
    });
    expect(store.get("bravo")?.retrieved_count).toBe(2);
  });

  test("getByIds returns matching skills in requested order", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "pdf-tool",
      name: "pdf-tool",
      description: "PDF to markdown.",
      body: "Use docling.",
      allowedTools: null,
      tags: null,
    });
    store.upsert({
      id: "shell-helper",
      name: "shell-helper",
      description: "Shell tips.",
      body: "Quote variables.",
      allowedTools: null,
      tags: null,
    });

    expect(store.getByIds(["shell-helper", "missing", "pdf-tool"]).map((s) => s.id))
      .toEqual(["shell-helper", "pdf-tool"]);
  });

  test("formatSkillContent renders heading, description, tags, allowed-tools, body", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "pdf-tool",
      name: "pdf-tool",
      description: "PDF to markdown.",
      body: "# PDF Tool\n\nBody.",
      allowedTools: "Bash(docling:*) Read",
      tags: "pdf docling",
    });
    const [pdf] = store.getAll();
    const md = formatSkillContent(pdf);
    expect(md.startsWith("### pdf-tool")).toBe(true);
    expect(md).toContain("**Tags:** pdf docling");
    expect(md).toContain("**Allowed tools:** Bash(docling:*) Read");
    expect(md).toContain("#### PDF Tool");
  });

  test("search returns matching skills via FTS", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "pdf-tool",
      name: "pdf-tool",
      description: "PDF to markdown.",
      body: "Use docling.",
      allowedTools: null,
      tags: "pdf docling",
    });
    store.upsert({
      id: "shell-helper",
      name: "shell-helper",
      description: "Shell tips.",
      body: "Quote your variables.",
      allowedTools: null,
      tags: "bash",
    });

    expect(store.search(["docling"]).map((s) => s.name)).toEqual(["pdf-tool"]);
    expect(store.search(["bash"]).map((s) => s.name)).toEqual(["shell-helper"]);
    expect(
      store.search(["docling", "bash"]).map((s) => s.name).sort(),
    ).toEqual(["pdf-tool", "shell-helper"]);
  });

  test("search sanitizes empty/operator-like queries", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "a",
      name: "a",
      description: "",
      body: "",
      allowedTools: null,
      tags: null,
    });
    expect(store.search([])).toEqual([]);
    expect(store.search([""])).toEqual([]);
    expect(store.search(["   "])).toEqual([]);
    expect(() => store.search(['NEAR("a", "b")'])).not.toThrow();
    expect(() => store.search(["AND OR NOT"])).not.toThrow();
  });

  test("page walks alphabetically with cursor and supports query filter", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    const names = ["alpha", "bravo", "charlie", "delta", "echo"];
    for (const n of names) {
      store.upsert({ id: n, name: n, description: "", body: "", allowedTools: null, tags: null });
    }
    const first = store.page({ cursor: null, limit: 2 });
    expect(first.items.map((s) => s.name)).toEqual(["alpha", "bravo"]);
    expect(first.nextCursor).not.toBeNull();

    const second = store.page({ cursor: first.nextCursor, limit: 2 });
    expect(second.items.map((s) => s.name)).toEqual(["charlie", "delta"]);

    const third = store.page({ cursor: second.nextCursor, limit: 2 });
    expect(third.items.map((s) => s.name)).toEqual(["echo"]);
    expect(third.nextCursor).toBeNull();

    const filtered = store.page({ cursor: null, limit: 10, query: "lph" });
    expect(filtered.items.map((s) => s.name)).toEqual(["alpha"]);
    expect(store.count({ query: "lph" })).toBe(1);
  });

  test("page can sort by retrieval count with a stable cursor", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    for (const id of ["alpha", "bravo", "charlie", "delta"])
      store.upsert({ id, name: id, description: "", body: "", allowedTools: null, tags: null });
    store.incrementRetrieved(["charlie"]);
    store.incrementRetrieved(["bravo"]);
    store.incrementRetrieved(["bravo"]);

    const first = store.page({ cursor: null, limit: 2, sort: "retrieved" });
    expect(first.items.map((s) => `${s.id}:${s.retrieved_count}`)).toEqual(["bravo:2", "charlie:1"]);
    expect(first.nextCursor).toEqual({ name: "charlie", id: "charlie", retrievedCount: 1 });

    const second = store.page({ cursor: first.nextCursor, limit: 2, sort: "retrieved" });
    expect(second.items.map((s) => `${s.id}:${s.retrieved_count}`)).toEqual([
      "alpha:0", "delta:0",
    ]);
    expect(second.nextCursor).toBeNull();
  });

  test("countDistinctTools counts unique whitespace-separated tools", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "a",
      name: "a",
      description: "",
      body: "",
      allowedTools: "Bash Read",
      tags: null,
    });
    store.upsert({
      id: "b",
      name: "b",
      description: "",
      body: "",
      allowedTools: "Read Edit",
      tags: null,
    });
    store.upsert({
      id: "c",
      name: "c",
      description: "",
      body: "",
      allowedTools: null,
      tags: null,
    });
    expect(store.countDistinctTools()).toBe(3);
  });

  test("stores bundle files, skill links, and usage events", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    const skill = store.upsert({
      id: "bundle-skill",
      name: "Bundle Skill",
      description: "Uses references.",
      whenToUse: "When a bundle is needed.",
      body: "Read [Ax Agent](skill:ax-agent).",
      allowedTools: null,
      tags: "bundle",
      disableModelInvocation: true,
      userInvocable: false,
      files: [{ path: "refs/guide.md", content: "extra guidance" }],
    });

    expect(skill.when_to_use).toBe("When a bundle is needed.");
    expect(skill.disable_model_invocation).toBe(true);
    expect(skill.user_invocable).toBe(false);
    expect(skill.files.map((file) => file.path)).toEqual(["refs/guide.md"]);
    expect(skill.links).toEqual(["ax-agent"]);
    expect(store.getFile("bundle-skill", "refs/guide.md")?.content).toBe("extra guidance");

    store.recordEvent({
      eventType: "used",
      skillId: "bundle-skill",
      sessionId: "s1",
      taskId: "t1",
      stage: "task",
      reason: "followed supporting guidance",
    });
    const updated = store.get("bundle-skill")!;
    expect(updated.used_count).toBe(1);
    expect(updated.last_used_at).toBeTruthy();
    expect(updated.recent_usage[0]).toMatchObject({
      reason: "followed supporting guidance",
      stage: "task",
    });
  });

  test("resolveSearchQueries prefers id then name before FTS fallback", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "coffee-finder",
      name: "Coffee Finder",
      description: "Find cafes.",
      body: "",
      allowedTools: null,
      tags: "coffee",
    });
    store.upsert({
      id: "shell-helper",
      name: "Shell Helper",
      description: "Careful shell workflow.",
      body: "",
      allowedTools: null,
      tags: "terminal",
    });
    store.upsert({
      id: "espresso-guide",
      name: "Cafe Guide",
      description: "Cafe planning.",
      body: "",
      allowedTools: null,
      tags: "espresso",
    });

    expect(store.resolveSearchQueries(["coffee-finder"]).map((match) => `${match.skill.id}:${match.matchKind}`))
      .toEqual(["coffee-finder:id"]);
    expect(store.resolveSearchQueries(["coffee finder"]).map((match) => `${match.skill.id}:${match.matchKind}`))
      .toEqual(["coffee-finder:id"]);
    expect(store.resolveSearchQueries(["Shell Helper"]).map((match) => `${match.skill.id}:${match.matchKind}`))
      .toEqual(["shell-helper:id"]);
    expect(store.resolveSearchQueries(["Cafe Guide"]).map((match) => `${match.skill.id}:${match.matchKind}`))
      .toEqual(["espresso-guide:name"]);
    expect(store.resolveSearchQueries(["terminal"]).map((match) => `${match.skill.id}:${match.matchKind}`))
      .toEqual(["shell-helper:search"]);
  });

  test("semantic search finds skill body and file chunks", async () => {
    const embedder = new MockEmbedder([["kubernetes rollback plan", "helm undo release"]]);
    const dirtied: string[] = [];
    const store = new SqliteSkillsStore(await tempDbPath(), {
      embedder,
      onDirtyIndex: ({ skills }) => dirtied.push(...skills),
    });
    if (!store.isHybridReady()) return;
    store.upsert({
      id: "deploy-recovery",
      name: "Deploy Recovery",
      description: "Recover bad deploys.",
      body: "Use release history and validate health after reversing.",
      allowedTools: null,
      tags: null,
      files: [{ path: "runbook.md", content: "helm undo release and inspect rollout events" }],
    });
    expect(dirtied).toEqual(["deploy-recovery"]);
    await store.indexEmbeddings(["deploy-recovery"]);
    const matches = await store.resolveSearchQueriesSemantic(["kubernetes rollback plan"]);
    expect(matches[0]?.skill.id).toBe("deploy-recovery");
    expect((matches as { diagnostics?: unknown }).diagnostics).toBeTruthy();
  });
});

describe("parseSkillBundleFiles", () => {
  test("parses a folder upload into a skill bundle", () => {
    const bundle = parseSkillBundleFiles([
      {
        path: "ax-agent/SKILL.md",
        content: [
          "---",
          "name: Ax Agent",
          "description: Agent guidance",
          "when_to_use: When building agents",
          "allowed-tools: Read Bash",
          "tags: [ax, agents]",
          "disable-model-invocation: true",
          "---",
          "",
          "# Steps",
        ].join("\n"),
      },
      { path: "ax-agent/references/runtime.md", content: "Runtime notes" },
    ]);

    expect(bundle).toMatchObject({
      id: "ax-agent",
      name: "Ax Agent",
      description: "Agent guidance",
      whenToUse: "When building agents",
      allowedTools: "Read Bash",
      tags: "ax agents",
      disableModelInvocation: true,
    });
    expect(bundle.files).toEqual([{ path: "references/runtime.md", content: "Runtime notes" }]);
  });

  test("rejects missing entrypoint and unsafe paths", () => {
    expect(() => parseSkillBundleFiles([{ path: "note.md", content: "x" }])).toThrow("SKILL.md");
    expect(() => parseSkillBundleFiles([
      { path: "bundle/SKILL.md", content: "---\nname: Bad\n---\n" },
      { path: "bundle/../secret.md", content: "x" },
    ])).toThrow("Unsafe");
  });

  test("builds an update diff for bundle review", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    const existing = store.upsert({
      id: "review-skill",
      name: "Review Skill",
      description: "Old",
      body: "Old body",
      allowedTools: null,
      tags: null,
      files: [{ path: "old.md", content: "old" }],
    });
    const next = parseSkillBundleFiles([
      { path: "SKILL.md", content: "---\nname: Review Skill\ndescription: New\n---\n\nNew body" },
      { path: "new.md", content: "new" },
    ]);

    expect(diffSkillBundle(existing, next)).toMatchObject({
      metadataChanged: ["description"],
      addedFiles: ["new.md"],
      removedFiles: ["old.md"],
      modifiedFiles: [],
      skillMarkdownChanged: true,
    });
  });
});

describe("seedSkillsIfEmpty", () => {
  test("seeds bundled skills into an empty store", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    seedSkillsIfEmpty(store);
    const all = store.getAll();
    expect(all.map((s) => s.id)).toContain("docling-processor");
    const docling = all.find((s) => s.id === "docling-processor")!;
    expect(docling.description).toContain("Docling");
    expect(docling.body).not.toContain("---\nname:");
  });

  test("does not reseed when skills already exist", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "custom",
      name: "custom",
      description: "",
      body: "",
      allowedTools: null,
      tags: null,
    });
    seedSkillsIfEmpty(store);
    expect(store.getAll().map((s) => s.id)).toEqual(["custom"]);
  });
});
