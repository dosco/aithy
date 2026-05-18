import { ax, f } from "@ax-llm/ax";
import { createAiService, createFastAiService } from "../agent/ai-service";
import type { AppConfig } from "../config/env";
import { EPISODE_OUTCOMES, type AgentEpisodeUpsert, type EpisodeOutcome } from "./types";

export interface DreamDetection {
  task: string;
  approach: string;
  outcome: EpisodeOutcome;
  notes: string;
  toolNames: string[];
  error: string | null;
  artifactIds: string[];
  importance: number;
  canonicalText: string;
  evidenceStartMessageId: number | null;
  evidenceEndMessageId: number | null;
}

export interface DreamDetector {
  forward(input: { transcript: string }): Promise<DreamDetection[]>;
  readonly program: unknown;
}

const signature = f()
  .input("transcript", f.string("Bounded transcript segment with message ids, including overlap context and new messages."))
  .output("tasks", f.string("Short title for each practical task episode. Empty array when none.").array("Episode tasks."))
  .output("approaches", f.string("How the agent approached the task, including strategy and important steps.").array("Episode approaches."))
  .output("outcomes", f.string("Outcome, exactly one of: success, partial, failure.").array("Episode outcomes."))
  .output("notes", f.string("Reusable lesson or gotcha for future similar tasks.").array("Episode notes."))
  .output("toolNames", f.string("Comma-separated tool names used, or empty.").array("Episode tools."))
  .output("errors", f.string("Error summary when outcome is partial/failure, or empty.").array("Episode errors."))
  .output("artifactIds", f.string("Comma-separated artifact ids, or empty.").array("Episode artifact ids."))
  .output("importances", f.number("Importance from 0 to 1.").array("Episode importance scores."))
  .output("canonicalTexts", f.string("Stable normalized summary for dedupe.").array("Episode canonical texts."))
  .output("evidenceStartMessageIds", f.number("First supporting message id.").array("Evidence start ids."))
  .output("evidenceEndMessageIds", f.number("Last supporting message id.").array("Evidence end ids."))
  .build();

const description = `You detect practical task episodes for Aithy's episodic memory.

Return only episodes that would help a future agent choose a better strategy for a similar task.

Good episodes:
- coding, debugging, testing, research, artifact, automation, memory, skill, or tool-use work
- tasks with a concrete approach and observable outcome
- failures, partial successes, slow paths, or gotchas that are useful later
- repeated repo workflows or project-specific operational lessons

Bad episodes:
- greetings, preferences, facts about the user, ordinary durable memories, jokes, or one-off chat
- vague "the user asked something" summaries with no reusable strategy
- claims not grounded in transcript evidence

Rules:
- Use only transcript evidence. Do not invent outcomes.
- Keep at most three episodes.
- Use evidence ids from the transcript. Prefer ids from [new ...] lines, with context ids only when needed.
- canonicalTexts should be stable across repeats of the same task/approach.
- This runs unattended and has no tools.`;

export function createDreamDetector(config: AppConfig): DreamDetector {
  const llm = createFastAiService(config) ?? createAiService(config);
  const program = ax(signature, {
    description,
    maxSteps: 1,
    debug: false,
  } as any);
  return {
    program,
    async forward(input) {
      const out = await program.forward(llm, input);
      return detectionsFromOutput(out).slice(0, 3);
    },
  };
}

export function detectionToUpsert(
  detection: DreamDetection,
  sourceSessionId: string,
  fallbackStart: number,
  fallbackEnd: number,
  validEvidenceIds: Set<number>,
): AgentEpisodeUpsert {
  const evidenceStart = validEvidenceId(validEvidenceIds, detection.evidenceStartMessageId) ?? fallbackStart;
  const evidenceEnd = validEvidenceId(validEvidenceIds, detection.evidenceEndMessageId) ?? fallbackEnd;
  return {
    task: detection.task,
    approach: detection.approach,
    outcome: detection.outcome,
    notes: detection.notes,
    toolNames: detection.toolNames,
    sourceSessionId,
    evidenceStartMessageId: Math.min(evidenceStart, evidenceEnd),
    evidenceEndMessageId: Math.max(evidenceStart, evidenceEnd),
    error: detection.error,
    artifactIds: detection.artifactIds,
    importance: detection.importance,
    canonicalText: detection.canonicalText,
  };
}

function detectionsFromOutput(out: Record<string, unknown>): DreamDetection[] {
  const tasks = strings(out.tasks);
  const approaches = strings(out.approaches);
  const outcomes = strings(out.outcomes);
  const notes = strings(out.notes);
  const toolNames = strings(out.toolNames);
  const errors = strings(out.errors);
  const artifactIds = strings(out.artifactIds);
  const importances = numbers(out.importances);
  const canonicalTexts = strings(out.canonicalTexts);
  const starts = numbers(out.evidenceStartMessageIds);
  const ends = numbers(out.evidenceEndMessageIds);

  return tasks.flatMap((task, index) => {
    const approach = (approaches[index] ?? "").trim();
    const outcome = normalizeOutcome(outcomes[index]);
    if (!task.trim() || !approach || !outcome) return [];
    return [{
      task: task.trim().slice(0, 300),
      approach: approach.slice(0, 4_000),
      outcome,
      notes: (notes[index] ?? "").trim().slice(0, 4_000),
      toolNames: splitList(toolNames[index]),
      error: cleanOptional(errors[index], 1_000),
      artifactIds: splitList(artifactIds[index]),
      importance: clamp(importances[index] ?? 0.5),
      canonicalText: (canonicalTexts[index] ?? `${task}\n${approach}`).trim().slice(0, 4_000),
      evidenceStartMessageId: numberOrNull(starts[index]),
      evidenceEndMessageId: numberOrNull(ends[index]),
    }];
  });
}

function normalizeOutcome(value: string | undefined): EpisodeOutcome | null {
  const normalized = value?.trim().toLowerCase();
  return (EPISODE_OUTCOMES as readonly string[]).includes(normalized ?? "")
    ? normalized as EpisodeOutcome
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

function splitList(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}

function cleanOptional(value: string | undefined, max: number): string | null {
  const text = value?.trim();
  return text ? text.slice(0, max) : null;
}

function numberOrNull(value: number | undefined): number | null {
  return value === undefined ? null : Math.floor(value);
}

function validEvidenceId(ids: Set<number>, value: number | null): number | null {
  return value !== null && ids.has(value) ? value : null;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
