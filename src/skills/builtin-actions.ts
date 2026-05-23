import type { Database } from "bun:sqlite";
import { slugify } from "./bundle";
import type { SkillEntry, SkillUpsert } from "./types";

export interface BuiltInActionContext {
  db: Database;
  get(id: string): SkillEntry | null;
  getBySourceId(sourceId: string): SkillEntry | null;
  upsert(skill: SkillUpsert): SkillEntry;
  onDirtyIndex?: (input: { skills: string[] }) => void;
}

export function builtInLocalIdForSource(db: Database, sourceId: string): string | null {
  const row = db
    .query("SELECT id FROM skills WHERE source_kind = 'builtin' AND source_id = $sourceId")
    .get({ $sourceId: sourceId }) as { id: string } | undefined;
  return row?.id ?? null;
}

export function setBuiltInDisabled(ctx: BuiltInActionContext, sourceId: string, disabled: boolean): SkillEntry {
  const skill = ctx.getBySourceId(sourceId);
  if (!skill) throw new Error(`Built-in skill not found: ${sourceId}`);
  const now = new Date().toISOString();
  ctx.db
    .query("UPDATE skills SET disabled_at = $disabledAt, updated_at = $now WHERE id = $id")
    .run({ $disabledAt: disabled ? now : null, $now: now, $id: skill.id });
  ctx.onDirtyIndex?.({ skills: [skill.id] });
  return ctx.get(skill.id)!;
}

export function duplicateBuiltIn(ctx: BuiltInActionContext, sourceId: string): SkillEntry {
  const skill = ctx.getBySourceId(sourceId);
  if (!skill) throw new Error(`Built-in skill not found: ${sourceId}`);
  return ctx.upsert({
    id: uniqueSkillId(ctx, `${skill.id}-copy`),
    name: `${skill.name} copy`,
    description: skill.description,
    whenToUse: skill.when_to_use,
    body: skill.body,
    allowedTools: skill.allowed_tools,
    tags: skill.tags,
    disableModelInvocation: skill.disable_model_invocation,
    userInvocable: skill.user_invocable,
    files: skill.files,
    duplicatedFromSourceId: sourceId,
  });
}

function uniqueSkillId(ctx: Pick<BuiltInActionContext, "get">, base: string): string {
  const slug = slugify(base) || "skill-copy";
  if (!ctx.get(slug)) return slug;
  for (let index = 2; index < 1_000; index += 1) {
    const candidate = `${slug}-${index}`;
    if (!ctx.get(candidate)) return candidate;
  }
  throw new Error("Could not create a unique skill id");
}
