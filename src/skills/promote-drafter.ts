import { ax, f } from "@ax-llm/ax";
import { createAiService } from "../agent/ai-service";
import type { AppConfig } from "../config/env";
import type { DetectedPattern } from "./promote-detector";
import type { SkillDraft } from "./promote-store";
import type { SkillEntry } from "./skills-store";

export interface SkillPromotionDrafter {
  forward(input: {
    pattern: DetectedPattern;
    existingSkills: readonly SkillEntry[];
  }): Promise<SkillDraft>;
  readonly program: unknown;
}

const draftSignature = f()
  .input("pattern", f.string("JSON describing a repeated tool-call pattern and recent examples."))
  .input("existingSkills", f.string("Existing skill ids and names, one per line."))
  .output("id", f.string("Lowercase slug id for the skill."))
  .output("name", f.string("Short human-readable skill name."))
  .output("description", f.string("One sentence describing when to use the skill."))
  .output("body", f.string("Markdown instructions for repeating this workflow safely."))
  .output("allowedTools", f.string("Space-separated tool names needed by this skill, or empty."))
  .output("tags", f.string("Comma-separated tags, or empty."))
  .build();

const description = `You draft reusable Aithy skills from repeated tool-call patterns.

Create a conservative skill that teaches the future agent when and how to repeat the workflow.
Use only facts visible in the examples. Do not include secrets, raw long outputs, or host-specific transient paths unless the pattern is explicitly about that path type.

The body must be practical markdown guidance. Prefer short checklists and caveats over narration.
The id must be a lowercase slug. Avoid ids that collide with existing skills.`;

export function createSkillPromotionDrafter(config: AppConfig): SkillPromotionDrafter {
  const llm = createAiService(config);
  const program = ax(draftSignature, {
    description,
    maxSteps: 1,
    debug: false,
  } as any);
  return {
    program,
    async forward(input) {
      const out = await program.forward(llm, {
        pattern: JSON.stringify(patternForPrompt(input.pattern), null, 2),
        existingSkills: formatExistingSkills(input.existingSkills),
      });
      return sanitizeDraft({
        id: String(out.id ?? ""),
        name: String(out.name ?? ""),
        description: String(out.description ?? ""),
        body: String(out.body ?? ""),
        allowedTools: cleanOptional(out.allowedTools),
        tags: cleanOptional(out.tags),
      }, input.pattern);
    },
  };
}

export function sanitizeDraft(draft: SkillDraft, pattern: DetectedPattern): SkillDraft {
  const id = slugify(draft.id || draft.name || pattern.argsPreview) || slugify(pattern.toolName);
  const name = draft.name.trim().slice(0, 120) || pattern.argsPreview.slice(0, 120);
  const description = draft.description.trim().slice(0, 2_000)
    || `Guidance for repeated ${pattern.argsPreview} usage.`;
  const body = draft.body.trim().slice(0, 50_000)
    || `Use ${pattern.toolName} for this repeated workflow. Review arguments before running.`;
  return {
    id,
    name,
    description,
    body,
    allowedTools: cleanOptional(draft.allowedTools),
    tags: cleanOptional(draft.tags),
  };
}

export function draftMessage(entry: {
  count: number;
  argsPreview: string;
  draft: SkillDraft;
}): string {
  const { draft } = entry;
  const tools = draft.allowedTools ? `\nAllowed tools: ${draft.allowedTools}` : "";
  const tags = draft.tags ? `\nTags: ${draft.tags}` : "";
  return [
    `I noticed this pattern ${entry.count} times in the last week: ${entry.argsPreview}`,
    "",
    `Proposed skill: ${draft.name}`,
    `Id: ${draft.id}`,
    `Description: ${draft.description}${tools}${tags}`,
    "",
    draft.body,
    "",
    "Reply `save`, `accept`, or `yes` to add it to Skills. Reply `dismiss` or `no` to ignore it.",
  ].join("\n");
}

function patternForPrompt(pattern: DetectedPattern) {
  return {
    signature: pattern.signature,
    toolName: pattern.toolName,
    argsPreview: pattern.argsPreview,
    count: pattern.count,
    firstSeenAt: pattern.firstSeenAt,
    lastSeenAt: pattern.lastSeenAt,
    examples: pattern.examples,
  };
}

function formatExistingSkills(skills: readonly SkillEntry[]): string {
  return skills.map((skill) => `${skill.id}: ${skill.name}`).join("\n");
}

function cleanOptional(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 500) : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
