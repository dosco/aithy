import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { createAgentTools } from "../src/agent/tools";
import { loadConfig } from "../src/config/env";
import { SqliteSkillsStore } from "../src/skills/skills-store";

describe("skills.read tool", () => {
  test("reads supporting files only for loaded skills", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-skill-tool-"));
    const skills = new SqliteSkillsStore(path.join(root, "state.db"));
    skills.upsert({
      id: "bundle-skill",
      name: "Bundle Skill",
      description: "",
      body: "",
      allowedTools: null,
      tags: null,
      files: [{ path: "refs/guide.md", content: "use the careful path" }],
    });
    const tool = createAgentTools({
      session: { conversationId: "conversation" },
      workspacePath: root,
      skills,
      loadedSkillIds: new Set(["bundle-skill"]),
    } as any, { ...loadConfig(), sandboxProvider: "disabled" })
      .find((item: any) => item.namespace === "skills" && item.name === "read") as any;

    expect(tool).toBeTruthy();
    expect(tool.func({ skillId: "bundle-skill", path: "refs/guide.md" })).toEqual({
      skillId: "bundle-skill",
      path: "refs/guide.md",
      content: "use the careful path",
    });
    expect(() => tool.func({ skillId: "missing", path: "refs/guide.md" })).toThrow("not loaded");
    skills.close();
  });
});
