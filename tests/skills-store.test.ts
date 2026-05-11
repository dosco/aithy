import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteSkillsStore, formatSkillContent } from "../src/skills/skills-store";
import { seedSkillsIfEmpty } from "../src/skills/seed";

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
