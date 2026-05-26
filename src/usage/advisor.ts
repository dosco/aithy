import type { TaskStatus } from "../tasks/types";
import type { UsageRecord } from "./types";

export type UsageAdvisorLabel =
  | "recommended"
  | "efficient"
  | "stable but costly"
  | "watch retries"
  | "not enough samples"
  | "no clear winner";

export type UsageAdvisorConfidence = "none" | "tentative" | "confident";
export type UsageAdvisorReliability = "known" | "unknown";

export interface UsageRunOutcome {
  runId: string;
  status: TaskStatus;
  attempt: number;
  retryOfTaskId: string | null;
}

export interface UsageAdvisorRow {
  component: string;
  stage: "ctx" | "task" | null;
  stages: Array<"ctx" | "task">;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  runs: number;
  successfulRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  unknownRuns: number;
  retryCount: number;
  tokensPerRun: number;
  tokensPerSuccessfulRun: number | null;
  cacheShare: number;
  outputThoughtRatio: number | null;
  latestSeenAt: string | null;
  label: UsageAdvisorLabel;
  confidence: UsageAdvisorConfidence;
  reliability: UsageAdvisorReliability;
  explanation: string;
}

export interface UsageAdvisorComponent {
  component: string;
  rows: UsageAdvisorRow[];
  recommendation: UsageAdvisorRow | null;
}

export interface UsageAdvisor {
  rows: UsageAdvisorRow[];
  components: UsageAdvisorComponent[];
}

export function buildUsageAdvisor(input: {
  records: readonly UsageRecord[];
  outcomes?: readonly UsageRunOutcome[];
  component?: string | null;
}): UsageAdvisor {
  const outcomes = new Map((input.outcomes ?? []).map((outcome) => [outcome.runId, outcome]));
  const groups = new Map<string, MutableAdvisorGroup>();
  let synthetic = 0;
  for (const record of input.records) {
    if (input.component && record.component !== input.component) continue;
    const key = `${record.component}\u0000${record.provider}\u0000${record.model}`;
    const group = groups.get(key) ?? createGroup(record);
    groups.set(key, group);
    group.inputTokens += record.inputTokens;
    group.outputTokens += record.outputTokens;
    group.thoughtTokens += record.thoughtTokens;
    group.cacheCreationTokens += record.cacheCreationTokens;
    group.cacheReadTokens += record.cacheReadTokens;
    group.totalTokens += record.totalTokens;
    if (record.stage) group.stages.add(record.stage);
    if (!group.latestSeenAt || record.occurredAt > group.latestSeenAt) group.latestSeenAt = record.occurredAt;
    const runKey = record.runId ?? `row:${record.id}:${synthetic++}`;
    group.runTokens.set(runKey, (group.runTokens.get(runKey) ?? 0) + record.totalTokens);
    if (record.runId) group.runOutcomes.set(runKey, outcomes.get(record.runId) ?? null);
    else group.runOutcomes.set(runKey, null);
  }

  const rows = [...groups.values()].map(baseRow);
  const byComponent = new Map<string, UsageAdvisorRow[]>();
  for (const row of rows) {
    const componentRows = byComponent.get(row.component) ?? [];
    componentRows.push(row);
    byComponent.set(row.component, componentRows);
  }

  for (const componentRows of byComponent.values()) {
    labelComponentRows(componentRows);
  }

  const components = [...byComponent.entries()]
    .map(([component, componentRows]) => ({
      component,
      rows: sortAdvisorRows(componentRows),
      recommendation: recommendedRow(componentRows),
    }))
    .sort((a, b) => a.component.localeCompare(b.component));

  return {
    rows: sortAdvisorRows(rows),
    components,
  };
}

interface MutableAdvisorGroup {
  component: string;
  provider: string;
  model: string;
  stages: Set<"ctx" | "task">;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  latestSeenAt: string | null;
  runTokens: Map<string, number>;
  runOutcomes: Map<string, UsageRunOutcome | null>;
}

function createGroup(record: UsageRecord): MutableAdvisorGroup {
  return {
    component: record.component,
    provider: record.provider,
    model: record.model,
    stages: new Set(),
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    latestSeenAt: null,
    runTokens: new Map(),
    runOutcomes: new Map(),
  };
}

function baseRow(group: MutableAdvisorGroup): UsageAdvisorRow {
  const runs = Math.max(1, group.runTokens.size);
  let successfulRuns = 0;
  let failedRuns = 0;
  let cancelledRuns = 0;
  let unknownRuns = 0;
  let retryCount = 0;
  let successfulTokens = 0;
  for (const [runKey, tokens] of group.runTokens) {
    const outcome = group.runOutcomes.get(runKey) ?? null;
    if (!outcome) {
      unknownRuns += 1;
      continue;
    }
    if (outcome.status === "completed") {
      successfulRuns += 1;
      successfulTokens += tokens;
    } else if (outcome.status === "failed") failedRuns += 1;
    else if (outcome.status === "cancelled") cancelledRuns += 1;
    else unknownRuns += 1;
    if (outcome.attempt > 1 || outcome.retryOfTaskId) retryCount += 1;
  }
  const stages = [...group.stages].sort();
  return {
    component: group.component,
    stage: stages.length === 1 ? stages[0] : null,
    stages,
    provider: group.provider,
    model: group.model,
    inputTokens: group.inputTokens,
    outputTokens: group.outputTokens,
    thoughtTokens: group.thoughtTokens,
    cacheCreationTokens: group.cacheCreationTokens,
    cacheReadTokens: group.cacheReadTokens,
    totalTokens: group.totalTokens,
    runs,
    successfulRuns,
    failedRuns,
    cancelledRuns,
    unknownRuns,
    retryCount,
    tokensPerRun: Math.round(group.totalTokens / runs),
    tokensPerSuccessfulRun: successfulRuns > 0 ? Math.round(successfulTokens / successfulRuns) : null,
    cacheShare: percentage(group.cacheCreationTokens + group.cacheReadTokens, group.inputTokens),
    outputThoughtRatio: group.thoughtTokens > 0 ? round(group.outputTokens / group.thoughtTokens, 2) : null,
    latestSeenAt: group.latestSeenAt,
    label: "not enough samples",
    confidence: confidenceForRuns(runs),
    reliability: successfulRuns + failedRuns + cancelledRuns > 0 ? "known" : "unknown",
    explanation: "",
  };
}

function labelComponentRows(rows: UsageAdvisorRow[]): void {
  const candidates = rows
    .filter((row) => row.runs >= 5 && !isRisky(row))
    .sort((a, b) => metric(a) - metric(b) || b.runs - a.runs);
  const best = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  const closeRace = Boolean(best && second && metric(second) <= metric(best) * 1.1);
  for (const row of rows) {
    row.label = labelForRow(row, best, closeRace);
    row.explanation = explanationFor(row, best);
  }
}

function labelForRow(
  row: UsageAdvisorRow,
  best: UsageAdvisorRow | null,
  closeRace: boolean,
): UsageAdvisorLabel {
  if (row.runs < 5) return "not enough samples";
  if (isRisky(row)) return "watch retries";
  if (!best) return "no clear winner";
  if (closeRace && metric(row) <= metric(best) * 1.1) return "no clear winner";
  if (row === best) return row.confidence === "confident" ? "recommended" : "efficient";
  if (isStable(row) && metric(row) > metric(best) * 1.35) return "stable but costly";
  return "no clear winner";
}

function explanationFor(row: UsageAdvisorRow, best: UsageAdvisorRow | null): string {
  if (row.label === "not enough samples") return `Only ${row.runs} observed run${row.runs === 1 ? "" : "s"}; wait for at least 5.`;
  if (row.label === "watch retries") return `Observed reliability is weaker: ${failureRate(row)}% failed/cancelled and ${retryRate(row)}% retried.`;
  if (row.label === "recommended") return `Best observed fit for ${row.component}: ${formatMetric(row)} tokens per successful run with enough samples.`;
  if (row.label === "efficient") return `Lowest observed token use for ${row.component}, but sample count is still tentative.`;
  if (row.label === "stable but costly") return `Reliable so far, but uses more tokens than ${best?.model ?? "the leanest observed model"}.`;
  return "Observed models are too close, sparse, or incomplete to pick a clear winner.";
}

function recommendedRow(rows: UsageAdvisorRow[]): UsageAdvisorRow | null {
  return rows.find((row) => row.label === "recommended")
    ?? rows.find((row) => row.label === "efficient")
    ?? null;
}

function sortAdvisorRows(rows: UsageAdvisorRow[]): UsageAdvisorRow[] {
  return [...rows].sort((a, b) =>
    labelRank(a.label) - labelRank(b.label)
    || a.component.localeCompare(b.component)
    || metric(a) - metric(b)
    || b.runs - a.runs
    || a.model.localeCompare(b.model)
  );
}

function metric(row: UsageAdvisorRow): number {
  return row.tokensPerSuccessfulRun ?? row.tokensPerRun;
}

function confidenceForRuns(runs: number): UsageAdvisorConfidence {
  if (runs < 5) return "none";
  if (runs < 20) return "tentative";
  return "confident";
}

function isRisky(row: UsageAdvisorRow): boolean {
  const known = knownRuns(row);
  return known >= 3 && (failureRate(row) >= 20 || retryRate(row) >= 25);
}

function isStable(row: UsageAdvisorRow): boolean {
  const known = knownRuns(row);
  return known > 0 && failureRate(row) <= 10 && retryRate(row) <= 10;
}

function knownRuns(row: UsageAdvisorRow): number {
  return row.successfulRuns + row.failedRuns + row.cancelledRuns;
}

function failureRate(row: UsageAdvisorRow): number {
  return percentage(row.failedRuns + row.cancelledRuns, knownRuns(row));
}

function retryRate(row: UsageAdvisorRow): number {
  return percentage(row.retryCount, row.runs);
}

function percentage(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function labelRank(label: UsageAdvisorLabel): number {
  return {
    recommended: 0,
    efficient: 1,
    "stable but costly": 2,
    "watch retries": 3,
    "no clear winner": 4,
    "not enough samples": 5,
  }[label];
}

function formatMetric(row: UsageAdvisorRow): string {
  return (row.tokensPerSuccessfulRun ?? row.tokensPerRun).toLocaleString();
}
