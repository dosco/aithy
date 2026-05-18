import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { MEMORY_KINDS, MEMORY_LABELS } from "../../src/memory/types";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { diffSkillBundle, parseSkillBundleFiles } from "../../src/skills/bundle";
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
});

export const upsertSkill = createServerFn({ method: "POST" })
  .inputValidator(skillUpsertInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const entry = runtime.skills.upsert({
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
  .inputValidator(skillBundleUploadInput.pick({ files: true }))
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
  .inputValidator(skillBundleUploadInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const bundle = parseSkillBundleFiles(data.files);
    const exists = Boolean(runtime.skills.get(bundle.id));
    if (exists && !data.confirmedOverwrite) throw new Error("This skill already exists; review the update before saving");
    const entry = runtime.skills.upsert({
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

export const deleteSkill = createServerFn({ method: "POST" })
  .inputValidator(skillDeleteInput)
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

const skillsPageInput = z.object({
  cursor: z.object({ name: z.string(), id: z.string(), retrievedCount: z.number().optional() }).nullable().optional(),
  query: z.string().max(200).optional(),
  limit: z.number().int().positive().max(200).optional(),
  sort: z.enum(["name", "retrieved"]).optional(),
});

export const listSkillsPaged = createServerFn({ method: "GET" })
  .inputValidator(skillsPageInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const limit = data.limit ?? SKILLS_PAGE_SIZE;
    const result = runtime.skills.page({
      cursor: data.cursor ?? null,
      limit,
      query: data.query,
      sort: data.sort,
    });
    return {
      items: result.items.map(skillDto),
      nextCursor: result.nextCursor,
      total: data.cursor ? null : runtime.skills.count({ query: data.query }),
    };
  });

const memoryKindSchema = z.enum(MEMORY_KINDS as [string, ...string[]]);
const memoryLabelSchema = z.enum(MEMORY_LABELS as [string, ...string[]]);

const memoryUpsertInput = z.object({
  id: z.string().min(1).max(120).optional(),
  kind: memoryKindSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8_000),
  labels: z.array(memoryLabelSchema).max(12).optional(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  durationDays: z.number().int().nonnegative().nullable().optional(),
  evidence: z.string().max(1_000).nullable().optional(),
  frequency: z.string().max(200).nullable().optional(),
  importance: z.number().min(0).max(1).optional(),
});

export const upsertMemory = createServerFn({ method: "POST" })
  .inputValidator(memoryUpsertInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const entry = runtime.memory.upsert({
      id: data.id,
      kind: data.kind as never,
      title: data.title.trim(),
      body: data.body,
      labels: data.labels as never,
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
  .inputValidator(memoryDeleteInput)
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
  labels: z.array(memoryLabelSchema).max(12).optional(),
  limit: z.number().int().positive().max(200).optional(),
  sort: z.enum(["recent", "retrieved"]).optional(),
});

export const listMemoriesPaged = createServerFn({ method: "GET" })
  .inputValidator(memoriesPageInput)
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const limit = data.limit ?? MEMORIES_PAGE_SIZE;
    const result = runtime.memory.page({
      cursor: data.cursor ?? null,
      limit,
      query: data.query,
      kind: data.kind as never,
      labels: data.labels as never,
      sort: data.sort,
    });
    return {
      items: result.items.map(memoryDto),
      nextCursor: result.nextCursor,
      total: data.cursor
        ? null
        : runtime.memory.count({ query: data.query, kind: data.kind as never, labels: data.labels as never }),
    };
  });
