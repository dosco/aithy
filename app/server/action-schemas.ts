import { z } from "zod";
import { isMeshSearchProvider } from "../../src/mesh/types";
import { INTERNAL_SANDBOX_IMAGE_IDS } from "../../src/sandbox/image-catalog";

const searchProviderInput = z.string().refine(
  (value) => value === "parallel" || value === "grok-subscription" || isMeshSearchProvider(value),
  "Invalid search provider.",
);

const sandboxImageSelectionInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("internal"), id: z.enum(INTERNAL_SANDBOX_IMAGE_IDS) }),
  z.object({ kind: z.literal("custom"), id: z.string().trim().min(1).max(80) }),
]);

const customSandboxImageInput = z.object({
  id: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  image: z.string().trim().min(1).max(500),
});

const localInferenceRuntimeInput = z.object({
  llamaServerPath: z.string().max(2000).optional(),
  contextSize: z.number().int().min(4096).max(262144).optional(),
  embeddingContextSize: z.number().int().min(1024).max(32768).optional(),
  rerankerContextSize: z.number().int().min(1024).max(40960).optional(),
  gpuLayers: z.number().int().min(0).max(999).optional(),
  flashAttention: z.boolean().optional(),
  batchSize: z.number().int().min(1).max(8192).optional(),
  ubatchSize: z.number().int().min(1).max(8192).optional(),
  modelsMax: z.number().int().min(1).max(16).optional(),
  kvCacheType: z.enum(["f16", "q8_0"]).optional(),
  thinkingMode: z.boolean().optional(),
  maxOutputTokens: z.number().int().min(1).max(81920).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topK: z.number().int().min(1).max(100).optional(),
  topP: z.number().min(0).max(1).optional(),
  minP: z.number().min(0).max(1).optional(),
  repeatPenalty: z.number().min(0).max(3).optional(),
  presencePenalty: z.number().min(0).max(3).optional(),
  frequencyPenalty: z.number().min(0).max(3).optional(),
});

export const sessionInput = z.object({
  conversationId: z.string().min(1).optional(),
});

export const conversationIdInput = z.object({
  conversationId: z.string().min(1),
});

export const permissionResponseInput = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["allow", "deny"]),
  persist: z.enum([
    "global",
    "exact_command",
    "cwd_prefix",
    "host_path_exact",
    "host_path_prefix",
    "website_origin",
  ]).optional(),
});

export const permissionRuleDeleteInput = z.object({ id: z.string().min(1) });

export const permissionRuleCreateInput = z.object({
  capability: z.string().min(1).max(120),
  matchKind: z.enum([
    "global",
    "exact_command",
    "cwd_prefix",
    "host_path_exact",
    "host_path_prefix",
    "website_origin",
  ]),
  matchValue: z.string().max(1000).nullable().optional(),
  reason: z.string().max(500).optional(),
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
    aiApiUrl: z.string().max(500).optional().nullable(),
    aiApiKey: z.string().optional().nullable(),
    aiModel: z.string().optional().nullable(),
    localAgentModel: z.string().optional().nullable(),
    localInference: localInferenceRuntimeInput.optional(),
    fastAiProvider: z.string().optional(),
    fastAiApiUrl: z.string().max(500).optional().nullable(),
    fastAiModel: z.string().optional(),
    aiProviderProfiles: z.record(z.string(), z.object({
      apiUrl: z.string().max(500).optional().nullable(),
      model: z.string().max(500).optional().nullable(),
      fastApiUrl: z.string().max(500).optional().nullable(),
      fastModel: z.string().max(500).optional().nullable(),
      secretVersion: z.number().int().min(0).optional(),
      validation: z.any().optional(),
      fastValidation: z.any().optional(),
    })).optional(),
    searchProvider: searchProviderInput.optional(),
    searchProviderProfiles: z.record(z.string(), z.object({
      url: z.string().max(500).optional().nullable(),
      mode: z.enum(["anonymous", "api-key", "grok-subscription"]).optional(),
      secretVersion: z.number().int().min(0).optional(),
      validation: z.any().optional(),
    })).optional(),
    sandboxProvider: z.enum(["microsandbox", "disabled"]).optional(),
    sandboxImageSelection: sandboxImageSelectionInput.optional(),
    customSandboxImages: z.array(customSandboxImageInput).max(20).optional(),
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
  provider: searchProviderInput.optional(),
  url: z.string().trim().min(1).max(500).optional(),
  apiKey: z.string().max(500).optional(),
});

export const grokSubscriptionLoginPollInput = z.object({
  loginId: z.string().min(1),
});

export const localInferenceSettingsInput = z.object({
  localAgentModel: z.string().trim().min(1).max(500),
  localInference: localInferenceRuntimeInput.optional(),
});

export const meshPairInput = z.object({
  peerId: z.string().min(1).max(200),
  code: z.string().trim().min(4).max(40),
});

export const meshPeerInput = z.object({
  peerId: z.string().min(1).max(200),
});

export const meshTrustInput = z.object({
  peerId: z.string().min(1).max(200),
  trustLevel: z.enum(["acquaintance", "friend", "family"]),
});

export const meshSharingInput = z.object({
  inference: z.boolean().optional(),
  search: z.boolean().optional(),
});

export const meshEnabledInput = z.object({
  enabled: z.boolean(),
});

export const meshCatalogInput = z.object({
  kind: z.enum(["inference", "search", "all"]).optional(),
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
