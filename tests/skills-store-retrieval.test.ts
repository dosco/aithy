import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { SqliteSkillsStore } from "../src/skills/skills-store";
import { MockEmbedder } from "./embed-mock";

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-skills-retrieval-"));
  return path.join(dir, "state.db");
}

describe("SqliteSkillsStore retrieval indexing", () => {
  test("skill updates clear stale semantic chunks until targeted indexing refreshes them", async () => {
    const embedder = new MockEmbedder([
      ["legacy skill", "legacy query"],
      ["fresh skill", "fresh query"],
    ]);
    const store = new SqliteSkillsStore(await tempDbPath(), { embedder });
    if (!store.isHybridReady()) return;

    store.upsert({
      id: "mutable-skill",
      name: "Mutable Skill",
      description: "Changes over time.",
      body: "legacy skill",
      allowedTools: null,
      tags: null,
    });
    await store.indexEmbeddings(["mutable-skill"]);
    store.upsert({
      id: "mutable-skill",
      name: "Mutable Skill",
      description: "Changes over time.",
      body: "legacy skill",
      allowedTools: null,
      tags: null,
    });
    expect(store.embeddingStats()).toMatchObject({ total: 2, embedded: 2, stale: 0 });

    store.upsert({
      id: "mutable-skill",
      name: "Mutable Skill",
      description: "Changes over time.",
      body: "fresh skill",
      allowedTools: null,
      tags: null,
    });
    expect((await store.resolveSearchQueriesSemantic(["legacy query"])).map((match) => match.skill.id)).toEqual([]);
    expect(store.embeddingStats()).toMatchObject({ total: 2, embedded: 0, stale: 2 });
    await store.indexEmbeddings(["mutable-skill"]);
    expect((await store.resolveSearchQueriesSemantic(["fresh query"]))[0]?.skill.id).toBe("mutable-skill");
  });
});
