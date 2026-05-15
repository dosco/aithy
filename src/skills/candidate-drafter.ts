import { ax, f } from "@ax-llm/ax";
import { createAiService } from "../agent/ai-service";
import type { AppConfig } from "../config/env";
import type { SkillCandidateEntry } from "./candidate-store";
import type { SkillDraft } from "./promote-store";
import type { SkillEntry } from "./skills-store";

export interface SkillCandidateDrafter {
  forward(input: {
    candidate: SkillCandidateEntry;
    evidence: string;
    existingSkills: readonly SkillEntry[];
  }): Promise<SkillDraft>;
  readonly program: unknown;
}

const signature = f()
  .input("candidate", f.string("JSON describing the accepted skill candidate."))
  .input("evidence", f.string("Source transcript evidence for the candidate."))
  .input("existingSkills", f.string("Existing skill ids and names, one per line."))
  .output("id", f.string("Lowercase slug id for the skill."))
  .output("name", f.string("Short human-readable skill name."))
  .output("description", f.string("One sentence describing when to use the skill."))
  .output("body", f.string("Markdown instructions for repeating this workflow safely."))
  .output("allowedTools", f.string("Space-separated tool names needed by this skill, or empty."))
  .output("tags", f.string("Comma-separated tags, or empty."))
  .build();

const description = `You draft reusable Aithy skills from user-approved candidates.

Create a conservative skill that teaches the future agent when and how to repeat the workflow.
Use only facts visible in the candidate and evidence. Do not include secrets, raw long outputs, or host-specific transient paths unless the workflow is explicitly about that path type.

The body must be practical markdown guidance. Prefer short checklists and caveats over narration.
The id must be a lowercase slug. Avoid ids that collide with existing skills.`;

export function createSkillCandidateDrafter(config: AppConfig): SkillCandidateDrafter {
  const llm = createAiService(config);
  const program = ax(signature, {
    description,
    maxSteps: 1,
    debug: false,
  } as any);
  return {
    program,
    async forward(input) {
      const out = await program.forward(llm, {
        candidate: JSON.stringify(candidateForPrompt(input.candidate), null, 2),
        evidence: input.evidence,
        existingSkills: input.existingSkills.map((skill) => `${skill.id}: ${skill.name}`).join("\n"),
      });
      return sanitizeDraft({
        id: String(out.id ?? ""),
        name: String(out.name ?? ""),
        description: String(out.description ?? ""),
        body: String(out.body ?? ""),
        allowedTools: cleanOptional(out.allowedTools),
        tags: cleanOptional(out.tags),
      }, input.candidate);
    },
  };
}

function sanitizeDraft(draft: SkillDraft, candidate: SkillCandidateEntry): SkillDraft {
  const id = slugify(draft.id || draft.name || candidate.title) || "promoted-skill";
  return {
    id,
    name: draft.name.trim().slice(0, 120) || candidate.title.slice(0, 120),
    description: draft.description.trim().slice(0, 2_000) || candidate.description,
    body: draft.body.trim().slice(0, 50_000) || `Use this workflow when: ${candidate.description}`,
    allowedTools: cleanOptional(draft.allowedTools),
    tags: cleanOptional(draft.tags ?? candidate.tags),
  };
}

function candidateForPrompt(candidate: SkillCandidateEntry) {
  return {
    id: candidate.id,
    title: candidate.title,
    description: candidate.description,
    canonicalText: candidate.canonicalText,
    rationale: candidate.rationale,
    confidence: candidate.confidence,
    tags: candidate.tags,
    sourceSessionId: candidate.sourceSessionId,
    evidenceStartMessageId: candidate.evidenceStartMessageId,
    evidenceEndMessageId: candidate.evidenceEndMessageId,
    seenCount: candidate.seenCount,
  };
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
