import { f, fn } from "@ax-llm/ax";
import { normalizeSkillFilePath } from "../../skills/bundle";
import type { ToolContext } from "../tool-context";

export function createSkillTools(ctx: ToolContext) {
  // Permission-exempt: this only reads text already stored inside Aithy's
  // SQLite skill library and only for skills loaded into the current turn.
  return [
    fn("read")
      .namespace("skills")
      .description("Read a text supporting file from a skill bundle that has already been loaded in this turn.")
      .arg("skillId", f.string("Loaded skill id"))
      .arg("path", f.string("Supporting file path inside the skill bundle"))
      .returnsField("skillId", f.string("Skill id"))
      .returnsField("path", f.string("Supporting file path"))
      .returnsField("content", f.string("Supporting file text content"))
      .handler(({ skillId, path }) => {
        if (!ctx.skills || !ctx.loadedSkillIds) throw new Error("Skill files are not available in this run");
        const id = skillId.trim();
        if (!ctx.loadedSkillIds.has(id)) throw new Error(`Skill is not loaded in this turn: ${id}`);
        const normalizedPath = normalizeSkillFilePath(path);
        const file = ctx.skills.getFile(id, normalizedPath);
        if (!file) throw new Error(`Skill file not found: ${id}/${normalizedPath}`);
        return { skillId: id, path: normalizedPath, content: file.content };
      })
      .build(),
  ];
}
