import type { AxAgentCatalogSkill } from "@ax-llm/ax";
import { formatSkillContent, type SqliteSkillsStore } from "./skills-store";

const TTL_MS = 30_000;
const MAX_DESCRIPTION_CHARS = 1_000;
const cache = new WeakMap<SqliteSkillsStore, { expiresAt: number; value: AxAgentCatalogSkill[] }>();

export function skillsCatalog(store: SqliteSkillsStore, now = Date.now()): readonly AxAgentCatalogSkill[] {
  const existing = cache.get(store);
  if (existing && existing.expiresAt > now) return existing.value;
  const value = store.getAll()
    .filter((skill) => !skill.disabled_at && !skill.disable_model_invocation)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: cap([skill.description, skill.when_to_use].filter(Boolean).join("\nWhen to use: ")),
      content: formatSkillContent(skill),
    }));
  cache.set(store, { expiresAt: now + TTL_MS, value });
  return value;
}

function cap(value: string): string {
  return value.length <= MAX_DESCRIPTION_CHARS ? value : `${value.slice(0, MAX_DESCRIPTION_CHARS - 13)} [truncated]`;
}
