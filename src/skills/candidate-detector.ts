import { ax, f } from "@ax-llm/ax";
import { createAiService, createFastAiService } from "../agent/ai-service";
import type { AppConfig } from "../config/env";
import type { SkillCandidateEntry } from "./candidate-store";

export interface SkillCandidateDetection {
  existingCandidateId: string | null;
  title: string;
  description: string;
  canonicalText: string;
  rationale: string;
  confidence: number;
  tags: string | null;
  evidenceStartMessageId: number | null;
  evidenceEndMessageId: number | null;
}

export interface SkillCandidateDetector {
  forward(input: {
    openCandidates: readonly SkillCandidateEntry[];
    transcript: string;
  }): Promise<SkillCandidateDetection[]>;
  readonly program: unknown;
}

const signature = f()
  .input("openCandidates", f.string("Existing developing skill candidates for this session. Empty if none."))
  .input("transcript", f.string("Bounded transcript segment with message ids, including overlap context and new messages."))
  .output("titles", f.string("Short human-readable title for each candidate. Empty array when none.").array("Candidate titles."))
  .output("descriptions", f.string("One-sentence description of when this would be useful as a skill.").array("Candidate descriptions."))
  .output("canonicalTexts", f.string("Stable normalized summary for dedupe.").array("Canonical candidate summaries."))
  .output("rationales", f.string("Why this resembles a reusable skill.").array("Candidate rationales."))
  .output("confidences", f.number("Confidence from 0 to 1.").array("Candidate confidences."))
  .output("tags", f.string("Comma-separated tags for the candidate, or empty.").array("Candidate tags."))
  .output("existingCandidateIds", f.string("Existing candidate id to update, or empty.").array("Existing candidate ids."))
  .output("evidenceStartMessageIds", f.number("First supporting message id.").array("Evidence start ids."))
  .output("evidenceEndMessageIds", f.number("Last supporting message id.").array("Evidence end ids."))
  .build();

const description = `You detect reusable workflow ideas that may become Aithy skills.

Return only candidates that would teach a future agent how to repeat a workflow, convention, or reusable process. Do not draft the skill body.

Good candidates:
- repeated or reusable tool workflows
- explicit "do this again", "make this reusable", "this is the normal flow"
- multi-step procedures likely to recur
- project-specific operating conventions useful in future turns

Bad candidates:
- one-off answers, facts, memories, preferences, or transient task state
- vague ideas with no actionable workflow
- anything requiring secrets or unsafe host access

Use existingCandidateIds when the transcript matures an existing developing candidate. Return empty arrays when there is nothing skill-worthy. Keep at most three candidates.`;

export function createSkillCandidateDetector(config: AppConfig): SkillCandidateDetector {
  const llm = createFastAiService(config) ?? createAiService(config);
  const program = ax(signature, {
    description,
    maxSteps: 1,
    debug: false,
  } as any);
  return {
    program,
    async forward(input) {
      const out = await program.forward(llm, {
        openCandidates: formatOpenCandidates(input.openCandidates),
        transcript: input.transcript,
      });
      return detectionsFromOutput(out).slice(0, 3);
    },
  };
}

function detectionsFromOutput(out: Record<string, unknown>): SkillCandidateDetection[] {
  const titles = strings(out.titles);
  const descriptions = strings(out.descriptions);
  const canonicalTexts = strings(out.canonicalTexts);
  const rationales = strings(out.rationales);
  const confidences = numbers(out.confidences);
  const tags = strings(out.tags);
  const existingCandidateIds = strings(out.existingCandidateIds);
  const starts = numbers(out.evidenceStartMessageIds);
  const ends = numbers(out.evidenceEndMessageIds);
  return titles.flatMap((title, index) => {
    const canonicalText = (canonicalTexts[index] ?? title).trim();
    if (!title.trim() || !canonicalText) return [];
    return [{
      existingCandidateId: cleanOptional(existingCandidateIds[index]),
      title: title.trim().slice(0, 160),
      description: (descriptions[index] ?? "").trim().slice(0, 2_000),
      canonicalText: canonicalText.slice(0, 4_000),
      rationale: (rationales[index] ?? "").trim().slice(0, 2_000),
      confidence: clamp(confidences[index] ?? 0),
      tags: cleanOptional(tags[index]),
      evidenceStartMessageId: numberOrNull(starts[index]),
      evidenceEndMessageId: numberOrNull(ends[index]),
    }];
  });
}

function formatOpenCandidates(candidates: readonly SkillCandidateEntry[]): string {
  if (candidates.length === 0) return "";
  return candidates.map((candidate) =>
    [
      `id: ${candidate.id}`,
      `title: ${candidate.title}`,
      `canonical: ${candidate.canonicalText}`,
      `status: ${candidate.status}`,
      `seen: ${candidate.seenCount}`,
    ].join("\n")
  ).join("\n\n");
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

function cleanOptional(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text.slice(0, 500) : null;
}

function numberOrNull(value: number | undefined): number | null {
  return value === undefined ? null : Math.floor(value);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
