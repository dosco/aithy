import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { MEMORY_GUIDANCE_VALUES, MEMORY_KINDS, MEMORY_SCOPE_KINDS, MEMORY_SUBJECTS } from "../../src/memory/types";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { diffSkillBundle, parseSkillBundleFiles } from "../../src/skills/bundle";
import { parseAuthoredEvals, skillEvalRunSummary, SqliteSkillEvalStore } from "../../src/skills/evals";
import {
  MEMORIES_PAGE_SIZE,
  SKILLS_PAGE_SIZE,
  memoryDto,
  skillDto,
} from "./dto";

const skillUpsertInput = z.object({
  id: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/, "id must be a slug"),
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  whenToUse: z.string().max(2000).nullable().optional(),
  body: z.string().max(50_000),
  allowedTools: z.string().max(500).nullable().optional(),
  tags: z.string().max(500).nullable().optional(),
  disableModelInvocation: z.boolean().optional(),
  userInvocable: z.boolean().optional(),
  files: z.array(z.object({
    path: z.string().min(1).max(240),
    content: z.string().max(100_000),
  })).max(40).optional(),
  evalsJson: z.string().max(40_000).optional(),
});

export const upsertSkill = createServerFn({ method: "POST" })
  .validator(skillUpsertInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const existing = runtime.skills.get(data.id);
    if (existing?.source_kind === "builtin") {
      throw new Error("Built-in skills are read-only. Duplicate the skill before editing it.");
    }
    const evals = parseAuthoredEvals(data.evalsJson ?? "");
    const entry = runtime.skills.upsert({
      evals,
      id: data.id,
      name: data.name.trim(),
      description: data.description.trim(),
      whenToUse: data.whenToUse?.trim() || null,
      body: data.body,
      allowedTools: data.allowedTools?.trim() || null,
      tags: data.tags?.trim() || null,
      disableModelInvocation: data.disableModelInvocation,
      userInvocable: data.userInvocable,
      files: data.files ?? [],
    });
    return {
      skill: skillDto(entry),
      skillsCount: runtime.skills.count(),
      skillsToolUniverse: runtime.skills.countDistinctTools(),
    };
  });

const bundleFileInput = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(100_000),
});

const skillBundleUploadInput = z.object({
  files: z.array(bundleFileInput).min(1).max(80),
  confirmedOverwrite: z.boolean().optional(),
});

export const previewSkillBundleUpload = createServerFn({ method: "POST" })
  .validator(skillBundleUploadInput.pick({ files: true }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const bundle = parseSkillBundleFiles(data.files);
    const existing = runtime.skills.get(bundle.id);
    return {
      bundle,
      exists: Boolean(existing),
      existing: existing ? skillDto(existing) : null,
      diff: diffSkillBundle(existing, bundle),
    };
  });

export const saveSkillBundleUpload = createServerFn({ method: "POST" })
  .validator(skillBundleUploadInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const bundle = parseSkillBundleFiles(data.files);
    const existing = runtime.skills.get(bundle.id);
    const exists = Boolean(existing);
    if (existing?.source_kind === "builtin") {
      throw new Error("Built-in skills are read-only. Duplicate the skill before editing it.");
    }
    if (exists && !data.confirmedOverwrite) throw new Error("This skill already exists; review the update before saving");
    const entry = runtime.skills.upsert({
      evals: bundle.evals,
      id: bundle.id,
      name: bundle.name,
      description: bundle.description,
      whenToUse: bundle.whenToUse,
      body: bundle.body,
      allowedTools: bundle.allowedTools,
      tags: bundle.tags,
      disableModelInvocation: bundle.disableModelInvocation,
      userInvocable: bundle.userInvocable,
      files: bundle.files,
    });
    return {
      skill: skillDto(entry),
      skillsCount: runtime.skills.count(),
      skillsToolUniverse: runtime.skills.countDistinctTools(),
    };
  });

const skillDeleteInput = z.object({ id: z.string().min(1) });
const builtInSourceInput = z.object({ sourceId: z.string().min(1).max(160) });

export const deleteSkill = createServerFn({ method: "POST" })
  .validator(skillDeleteInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const removed = runtime.skills.delete(data.id);
    return {
      removed,
      skillsCount: runtime.skills.count(),
      skillsToolUniverse: runtime.skills.countDistinctTools(),
    };
  });

export const duplicateBuiltInSkill = createServerFn({ method: "POST" })
  .validator(builtInSourceInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const entry = runtime.skills.duplicateBuiltInSkill(data.sourceId);
    return {
      skill: skillDto(entry),
      skillsCount: runtime.skills.count(),
      skillsToolUniverse: runtime.skills.countDistinctTools(),
    };
  });

export const setBuiltInSkillDisabled = createServerFn({ method: "POST" })
  .validator(builtInSourceInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    return { skill: skillDto((await getAithyRuntime()).skills.setBuiltInSkillDisabled(data.sourceId)) };
  });

export const setBuiltInSkillEnabled = createServerFn({ method: "POST" })
  .validator(builtInSourceInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    return { skill: skillDto((await getAithyRuntime()).skills.setBuiltInSkillEnabled(data.sourceId)) };
  });

export const runSkillEval = createServerFn({ method: "POST" })
  .validator(z.object({ skillId: z.string().min(1).max(120) }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const skill = runtime.skills.get(data.skillId);
    if (!skill) throw new Error(`Skill not found: ${data.skillId}`);
    const task = runtime.tasks.create({ kind: "skill.eval", title: `Test ${skill.name}`,
      reason: "Queued for isolated skill evaluation", metadata: { skillId: skill.id } });
    runtime.events.emit({ type: "task.status", task });
    try {
      const commandId = await runtime.queue.submitCommand("agent-worker", "skill.eval", { skillId: skill.id, taskId: task.id });
      const queued = runtime.tasks.update(task.id, { runtimeCommandId: commandId }) ?? task;
      return { task: { id: queued.id, status: queued.status } };
    } catch (error) {
      runtime.tasks.update(task.id, { status: "failed", errorSummary: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  });

export const listSkillEvalRuns = createServerFn({ method: "GET" })
  .validator(z.object({ skillId: z.string().min(1).max(120) }))
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const store = new SqliteSkillEvalStore(runtime.config.stateDbPath);
    try { return store.recent(data.skillId, 20).map(skillEvalRunSummary); } finally { store.close(); }
  });

const skillsPageInput = z.object({
  cursor: z.object({ name: z.string(), id: z.string(), retrievedCount: z.number().optional(), usedCount: z.number().optional() }).nullable().optional(),
  query: z.string().max(200).optional(),
  limit: z.number().int().positive().max(200).optional(),
  sort: z.enum(["name", "retrieved", "used"]).optional(),
  activeOnly: z.boolean().optional(),
});

export const listSkillsPaged = createServerFn({ method: "GET" })
  .validator(skillsPageInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const limit = data.limit ?? SKILLS_PAGE_SIZE;
    const result = runtime.skills.page({
      cursor: data.cursor ?? null,
      limit,
      query: data.query,
      sort: data.sort,
      activeOnly: data.activeOnly,
    });
    return {
      items: result.items.map((skill) => skillDto(skill)),
      nextCursor: result.nextCursor,
      total: data.cursor ? null : runtime.skills.count({ query: data.query, activeOnly: data.activeOnly }),
    };
  });

const memoryKindSchema = z.enum(MEMORY_KINDS as [string, ...string[]]);
const memorySubjectSchema = z.enum(MEMORY_SUBJECTS as [string, ...string[]]);
const memoryScopeKindSchema = z.enum(MEMORY_SCOPE_KINDS as [string, ...string[]]);
const memoryGuidanceSchema = z.enum(MEMORY_GUIDANCE_VALUES as [string, ...string[]]);

const memoryUpsertInput = z.object({
  id: z.string().min(1).max(120).optional(),
  kind: memoryKindSchema,
  subject: memorySubjectSchema.optional(),
  scopeKind: memoryScopeKindSchema.optional(),
  scopeRef: z.string().max(500).nullable().optional(),
  guidance: memoryGuidanceSchema.optional(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8_000),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  durationDays: z.number().int().nonnegative().nullable().optional(),
  evidence: z.string().max(1_000).nullable().optional(),
  frequency: z.string().max(200).nullable().optional(),
  importance: z.number().min(0).max(1).optional(),
});

export const upsertMemory = createServerFn({ method: "POST" })
  .validator(memoryUpsertInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const entry = runtime.memory.upsert({
      id: data.id,
      kind: data.kind as never,
      subject: data.subject as never,
      scopeKind: data.scopeKind as never,
      scopeRef: data.scopeRef,
      guidance: data.guidance as never,
      title: data.title.trim(),
      body: data.body,
      validFrom: data.validFrom,
      validUntil: data.validUntil,
      durationDays: data.durationDays,
      evidence: data.evidence,
      frequency: data.frequency,
      importance: data.importance,
      source: "ui",
    });
    const mostRecent = runtime.memory.mostRecent();
    return {
      memory: memoryDto(entry),
      memoriesCount: runtime.memory.count(),
      memoriesMostRecent: mostRecent ? { title: mostRecent.title } : null,
    };
  });

const memoryDeleteInput = z.object({ id: z.string().min(1) });

export const deleteMemory = createServerFn({ method: "POST" })
  .validator(memoryDeleteInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const removed = runtime.memory.delete(data.id);
    const mostRecent = runtime.memory.mostRecent();
    return {
      removed,
      memoriesCount: runtime.memory.count(),
      memoriesMostRecent: mostRecent ? { title: mostRecent.title } : null,
    };
  });

const memoriesPageInput = z.object({
  cursor: z.object({
    updatedAt: z.string(),
    id: z.string(),
    retrievedCount: z.number().optional(),
  }).nullable().optional(),
  query: z.string().max(200).optional(),
  kind: memoryKindSchema.optional(),
  subject: memorySubjectSchema.optional(),
  guidance: memoryGuidanceSchema.optional(),
  scopeKind: memoryScopeKindSchema.optional(),
  limit: z.number().int().positive().max(200).optional(),
  sort: z.enum(["recent", "retrieved"]).optional(),
});

export const listMemoriesPaged = createServerFn({ method: "GET" })
  .validator(memoriesPageInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const limit = data.limit ?? MEMORIES_PAGE_SIZE;
    const result = runtime.memory.page({
      cursor: data.cursor ?? null,
      limit,
      query: data.query,
      kind: data.kind as never,
      subject: data.subject as never,
      guidance: data.guidance as never,
      scopeKind: data.scopeKind as never,
      sort: data.sort,
    });
    return {
      items: result.items.map(memoryDto),
      nextCursor: result.nextCursor,
      total: data.cursor
        ? null
        : runtime.memory.count({
            query: data.query,
            kind: data.kind as never,
            subject: data.subject as never,
            guidance: data.guidance as never,
            scopeKind: data.scopeKind as never,
          }),
    };
  });
