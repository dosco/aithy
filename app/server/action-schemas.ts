import { z } from "zod";

export const sessionInput = z.object({
  conversationId: z.string().min(1).optional(),
});

export const conversationIdInput = z.object({
  conversationId: z.string().min(1),
});

export const permissionResponseInput = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["allow", "deny"]),
});

export const sendInput = z.object({
  conversationId: z.string().min(1),
  text: z.string().min(1),
  createdAt: z.string().datetime(),
  skillIds: z.array(z.string().min(1)).max(20).optional(),
});

export const renameInput = z.object({
  conversationId: z.string().min(1),
  name: z.string().min(1),
});

export const confirmationInput = z.object({
  confirmation: z.literal("Yes, I'm sure"),
});

export const settingsInput = z.object({
  runtime: z.object({
    aiProvider: z.string().optional(),
    aiApiKey: z.string().optional().nullable(),
    aiModel: z.string().optional().nullable(),
    fastAiProvider: z.string().optional(),
    fastAiModel: z.string().optional(),
    sandboxProvider: z.enum(["microsandbox", "disabled"]).optional(),
    sandboxImage: z.string().optional(),
    sandboxCpus: z.number().positive().optional(),
    sandboxMemoryMb: z.number().positive().optional(),
    sandboxNetwork: z.enum(["none", "public", "allow-all"]).optional(),
    sessionTtlMs: z.number().positive().optional(),
    parallelAgents: z.number().int().min(1).max(8).optional(),
    parallelSearchMcpUrl: z.string().max(500).optional().nullable(),
    systemBashEnabled: z.boolean().optional(),
    traceEnabled: z.boolean().optional(),
    globalMounts: z.array(z.object({ hostPath: z.string().min(1) })).optional(),
  }).optional(),
  ui: z.object({
    theme: z.enum([
      "paper",
      "graphite",
      "violet-ascii",
      "terminal-glow",
      "sunrise",
      "ocean",
      "matcha",
      "rose-quartz",
      "noir",
      "amber",
    ]).optional(),
    colorMode: z.enum(["light", "dark", "system"]).optional(),
    layout: z.enum(["chat", "work"]).optional(),
    detailsDefault: z.boolean().optional(),
    lastActiveSessionId: z.string().nullable().optional(),
  }).optional(),
  apiKey: z.string().optional(),
  clearApiKey: z.boolean().optional(),
  clearAiModel: z.boolean().optional(),
  fastApiKey: z.string().optional(),
  clearFastApiKey: z.boolean().optional(),
  parallelApiKey: z.string().max(500).optional(),
  clearParallelApiKey: z.boolean().optional(),
});

export const parallelSearchTestInput = z.object({
  query: z.string().trim().min(2).max(200),
  url: z.string().trim().min(1).max(500).optional(),
  apiKey: z.string().max(500).optional(),
});

export const soulInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000),
  coreNature: z.string().max(4000),
  communicationStyle: z.string().max(4000),
  behaviour: z.string().max(4000),
  negativeBehavior: z.string().max(4000),
});

export const notificationIdInput = z.object({ id: z.number().int().positive() });

export const usageInput = z.object({ days: z.number().int().min(1).max(365).optional() });
