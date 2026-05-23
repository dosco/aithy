import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { sessionMigrations } from "../src/session/sqlite-session-schema";
import { applySqliteMigrations } from "../src/sqlite/migrations";
import { frontmatterString, parseSkillMarkdown } from "../src/skills/frontmatter";
import { builtInSkillSources, BUILT_IN_SKILL_SOURCE_VERSION, syncBuiltInSkills } from "../src/skills/seed";
import { SqliteSkillsStore } from "../src/skills/skills-store";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-builtin-skills-"));
  return path.join(dir, "state.db");
}

function sourceHash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

describe("built-in skills", () => {
  test("migration defaults existing skills to user-owned", async () => {
    const dbPath = await tempDbPath();
    const db = new Database(dbPath, { create: true });
    applySqliteMigrations(db, "session", sessionMigrations.filter((migration) => migration.version <= 7));
    db.query(`
      INSERT INTO skills (id, name, description, content, updated_at)
      VALUES ('legacy', 'Legacy', 'Existing skill', 'body', '2026-01-01T00:00:00.000Z')
    `).run();
    db.close();

    const store = new SqliteSkillsStore(dbPath);
    const legacy = store.get("legacy");
    expect(legacy?.source_kind).toBe("user");
    expect(legacy?.source_id).toBeNull();
    expect(legacy?.disabled_at).toBeNull();
  });

  test("sync seeds the curated catalog with source metadata", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    syncBuiltInSkills(store);

    expect(store.count()).toBe(builtInSkillSources.length);
    for (const source of builtInSkillSources) {
      const skill = store.getBySourceId(source.sourceId);
      expect(skill?.source_kind).toBe("builtin");
      expect(skill?.source_id).toBe(source.sourceId);
      expect(skill?.source_version).toBe(BUILT_IN_SKILL_SOURCE_VERSION);
      expect(skill?.source_hash).toBe(sourceHash(source.raw));
      expect(skill?.disabled_at).toBeNull();
    }
  });

  test("sync preserves user id collisions and adds missing built-ins", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    store.upsert({
      id: "document-conversion-docling",
      name: "Custom Docling",
      description: "user-owned",
      body: "custom body",
      allowedTools: null,
      tags: null,
    });

    syncBuiltInSkills(store);

    expect(store.get("document-conversion-docling")?.source_kind).toBe("user");
    expect(store.get("document-conversion-docling")?.body).toContain("custom body");
    expect(store.getBySourceId("document-conversion-docling")?.id).toBe("document-conversion-docling-builtin");
    expect(store.count()).toBe(builtInSkillSources.length + 1);
  });

  test("sync updates built-ins by source id and preserves disabled state", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    syncBuiltInSkills(store);
    const source = builtInSkillSources.find((item) => item.sourceId === "pdf-fast-text-extraction")!;
    const builtIn = store.getBySourceId(source.sourceId)!;

    store.upsert({
      id: builtIn.id,
      name: "Stale",
      description: "Stale",
      body: "stale body",
      allowedTools: null,
      tags: null,
      sourceKind: "builtin",
      sourceId: source.sourceId,
      sourceVersion: "old",
      sourceHash: "old",
    }, { allowBuiltIn: true });
    store.setBuiltInSkillDisabled(source.sourceId);
    syncBuiltInSkills(store);

    const refreshed = store.get(builtIn.id)!;
    expect(refreshed.name).not.toBe("Stale");
    expect(refreshed.source_hash).toBe(sourceHash(source.raw));
    expect(refreshed.disabled_at).toBeTruthy();
  });

  test("built-ins are read-only, duplicable, and excluded when disabled", async () => {
    const store = new SqliteSkillsStore(await tempDbPath());
    syncBuiltInSkills(store);
    const sourceId = "pdf-fast-text-extraction";
    const builtIn = store.getBySourceId(sourceId)!;

    expect(() => store.upsert({
      id: builtIn.id,
      name: "edited",
      description: "",
      body: "",
      allowedTools: null,
      tags: null,
    })).toThrow(/Built-in skills are read-only/);
    expect(() => store.delete(builtIn.id)).toThrow(/Built-in skills cannot be deleted/);

    const copy = store.duplicateBuiltInSkill(sourceId);
    expect(copy.source_kind).toBe("user");
    expect(copy.duplicated_from_source_id).toBe(sourceId);
    expect(store.upsert({
      id: copy.id,
      name: "Editable copy",
      description: copy.description,
      body: copy.body,
      allowedTools: copy.allowed_tools,
      tags: copy.tags,
    }).name).toBe("Editable copy");

    const disabled = store.setBuiltInSkillDisabled(sourceId);
    expect(disabled.disabled_at).toBeTruthy();
    expect(store.getByIds([builtIn.id], { activeOnly: true })).toEqual([]);
    expect(store.page({ cursor: null, limit: 100, activeOnly: true }).items.map((s) => s.id)).not.toContain(builtIn.id);
    expect(store.page({ cursor: null, limit: 100 }).items.map((s) => s.id)).toContain(builtIn.id);
    expect(store.resolveSearchQueries([builtIn.id]).map((match) => match.skill.id)).not.toContain(builtIn.id);
    expect(store.search(["pdf"], 30).map((skill) => skill.id)).not.toContain(builtIn.id);
  });

  test("every bundled skill parses cleanly and avoids unavailable tool claims", () => {
    expect(builtInSkillSources).toHaveLength(24);
    for (const source of builtInSkillSources) {
      const { frontmatter, body } = parseSkillMarkdown(source.raw);
      const description = frontmatterString(frontmatter, ["description"]);
      const whenToUse = frontmatterString(frontmatter, ["when_to_use", "when-to-use"]);
      const tags = frontmatterString(frontmatter, ["tags"]);
      const tools = frontmatterString(frontmatter, ["tools", "allowed-tools", "allowed_tools"]);

      expect(description?.trim()).toBeTruthy();
      expect(whenToUse?.trim()).toBeTruthy();
      expect(tags?.trim()).toBeTruthy();
      expect(tools?.toLowerCase()).not.toContain("pandoc");
      expect(tools).not.toMatch(/Bash\(zip/i);
      expect(body.toLowerCase()).not.toContain("pandoc");
    }
  });
});
