import doclingProcessor from "../../config/skills/docling-processor.md" with { type: "text" };
import { parseSkillMarkdown } from "./frontmatter";
import type { SqliteSkillsStore, SkillUpsert } from "./skills-store";

const seedSources: Record<string, string> = {
  "docling-processor": doclingProcessor,
};

export function seedSkillsIfEmpty(store: SqliteSkillsStore): void {
  if (store.count() > 0) return;
  for (const [id, raw] of Object.entries(seedSources)) {
    store.upsert(seedToUpsert(id, raw));
  }
}

function seedToUpsert(id: string, raw: string): SkillUpsert {
  const { frontmatter, body } = parseSkillMarkdown(raw);
  return {
    id,
    name: frontmatter.name ?? id,
    description: frontmatter.description ?? "",
    body,
    allowedTools: frontmatter["allowed-tools"] ?? null,
    tags: frontmatter.tags ?? null,
  };
}
