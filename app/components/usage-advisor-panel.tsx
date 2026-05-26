import { Activity, CircleHelp, Gauge, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UsageAdvisorDto, UsageAdvisorRowDto } from "@/server/dto";
import { usageProviderLabel } from "./usage-page-model";

const MAJOR_COMPONENTS = [
  "chat.actor",
  "chat.responder",
  "memory.triage",
  "memory.consolidate",
  "memory.dream",
  "skill.promote",
];

const LABEL_TONE: Record<UsageAdvisorRowDto["label"], string> = {
  recommended: "border-emerald-500/35 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300",
  efficient: "border-sky-500/35 bg-sky-500/[0.08] text-sky-700 dark:text-sky-300",
  "stable but costly": "border-amber-500/35 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300",
  "watch retries": "border-red-500/35 bg-red-500/[0.08] text-red-700 dark:text-red-300",
  "not enough samples": "border-[rgb(var(--border))] bg-[rgb(var(--muted))]/35 text-[rgb(var(--muted-foreground))]",
  "no clear winner": "border-[rgb(var(--border))] bg-[rgb(var(--panel))]/60 text-[rgb(var(--muted-foreground))]",
};

export function UsageAdvisorPanel({ advisor }: { advisor: UsageAdvisorDto | null }) {
  const rows = advisor?.rows ?? [];
  const components = advisor?.components ?? [];
  const modelKeys = uniqueModels(rows);
  const componentNames = uniqueComponents(components);

  return (
    <section className="mb-6 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/35 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
            <Gauge className="h-3.5 w-3.5" /> usage advisor
          </p>
          <p className="mt-2 max-w-2xl text-sm text-[rgb(var(--muted-foreground))]">
            Component-level model guidance from local usage, tokens, cache behavior, and task outcomes when Aithy can connect a run to a task.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-[rgb(var(--border))] px-3 py-2 text-xs text-[rgb(var(--muted-foreground))]">
          <Info className="h-3.5 w-3.5" />
          Advisory only; Aithy will not switch models automatically.
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[rgb(var(--border))] px-4 py-8 text-center text-xs text-[rgb(var(--muted-foreground))]">
          no advisor samples yet. Usage will appear here after model calls are captured.
        </div>
      ) : (
        <>
          <RecommendationGrid components={components} />
          <AdvisorMatrix rows={rows} components={componentNames} modelKeys={modelKeys} />
          <AdvisorDetails rows={rows} />
        </>
      )}
    </section>
  );
}

function RecommendationGrid({ components }: { components: UsageAdvisorDto["components"] }) {
  const map = new Map(components.map((component) => [component.component, component]));
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {MAJOR_COMPONENTS.map((name) => {
        const component = map.get(name);
        const row = component?.recommendation ?? component?.rows[0] ?? null;
        return (
          <div key={name} className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))]/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{name}</div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-[rgb(var(--muted-foreground))]">
                  {row ? modelLabel(row) : "no samples"}
                </div>
              </div>
              {row ? <LabelPill label={row.label} /> : <EmptyPill />}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <MiniMetric label="runs" value={row ? row.runs.toLocaleString() : "0"} />
              <MiniMetric label="tokens/run" value={row ? row.tokensPerRun.toLocaleString() : "0"} />
              <MiniMetric label="reliability" value={reliabilityText(row)} />
            </div>
            <p className="mt-3 text-xs leading-5 text-[rgb(var(--muted-foreground))]">
              {row?.explanation ?? "Collect at least five observed runs before Aithy makes a recommendation."}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function AdvisorMatrix({
  rows,
  components,
  modelKeys,
}: {
  rows: UsageAdvisorRowDto[];
  components: string[];
  modelKeys: string[];
}) {
  const lookup = new Map(rows.map((row) => [`${row.component}\u0000${modelKey(row)}`, row]));
  return (
    <div className="mt-5 overflow-x-auto rounded-lg border border-[rgb(var(--border))]">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="bg-[rgb(var(--muted))]/35 text-[rgb(var(--muted-foreground))]">
          <tr>
            <th className="sticky left-0 z-10 bg-[rgb(var(--muted))] px-3 py-2 font-mono uppercase tracking-[0.16em]">
              component
            </th>
            {modelKeys.map((key) => (
              <th key={key} className="min-w-44 px-3 py-2 font-mono uppercase tracking-[0.16em]">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {components.map((component) => (
            <tr key={component} className="border-t border-[rgb(var(--border))]">
              <td className="sticky left-0 z-10 bg-[rgb(var(--panel))] px-3 py-3 font-medium">{component}</td>
              {modelKeys.map((key) => {
                const row = lookup.get(`${component}\u0000${key}`);
                return (
                  <td key={key} className="px-3 py-3 align-top">
                    {row ? <MatrixCell row={row} /> : <span className="text-[rgb(var(--muted-foreground))]">-</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixCell({ row }: { row: UsageAdvisorRowDto }) {
  return (
    <div className="grid gap-1">
      <LabelPill label={row.label} />
      <div className="tabular-nums">{row.tokensPerRun.toLocaleString()} tokens/run</div>
      <div className="text-[rgb(var(--muted-foreground))]">
        {row.runs} runs · {reliabilityText(row)}
      </div>
    </div>
  );
}

function AdvisorDetails({ rows }: { rows: UsageAdvisorRowDto[] }) {
  return (
    <div className="mt-5 grid gap-2">
      {rows.map((row) => (
        <details
          key={`${row.component}/${row.provider}/${row.model}`}
          className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))]/35 px-4 py-3"
        >
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <Activity className="h-4 w-4 shrink-0 text-[rgb(var(--muted-foreground))]" />
              <span className="truncate text-sm font-medium">{row.component}</span>
              <span className="truncate text-xs text-[rgb(var(--muted-foreground))]">{modelLabel(row)}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-[rgb(var(--muted-foreground))]">
                {row.tokensPerRun.toLocaleString()} / run
              </span>
              <LabelPill label={row.label} />
            </span>
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <MiniMetric label="successful" value={row.successfulRuns.toLocaleString()} />
            <MiniMetric label="failed/cancelled" value={(row.failedRuns + row.cancelledRuns).toLocaleString()} />
            <MiniMetric label="retries" value={`${row.retryCount.toLocaleString()} (${percentage(row.retryCount, row.runs)}%)`} />
            <MiniMetric label="cache share" value={`${row.cacheShare}%`} />
            <MiniMetric label="tokens/success" value={row.tokensPerSuccessfulRun?.toLocaleString() ?? "unknown"} />
            <MiniMetric label="output" value={row.outputTokens.toLocaleString()} />
            <MiniMetric label="thinking" value={row.thoughtTokens.toLocaleString()} />
            <MiniMetric label="latest" value={row.latestSeenAt ? row.latestSeenAt.slice(0, 10) : "unknown"} />
          </div>
          <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[rgb(var(--muted-foreground))]">
            <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {row.explanation}
          </p>
        </details>
      ))}
    </div>
  );
}

function LabelPill({ label }: { label: UsageAdvisorRowDto["label"] }) {
  return (
    <span className={cn("inline-flex w-fit rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide", LABEL_TONE[label])}>
      {label}
    </span>
  );
}

function EmptyPill() {
  return (
    <span className="inline-flex w-fit rounded border border-[rgb(var(--border))] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[rgb(var(--muted-foreground))]">
      no samples
    </span>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/35 px-2.5 py-2">
      <div className="truncate font-mono text-[10px] uppercase tracking-wide text-[rgb(var(--muted-foreground))]">{label}</div>
      <div className="mt-1 truncate text-sm tabular-nums">{value}</div>
    </div>
  );
}

function uniqueModels(rows: UsageAdvisorRowDto[]): string[] {
  return [...new Set(rows.map(modelKey))].sort();
}

function uniqueComponents(components: UsageAdvisorDto["components"]): string[] {
  return [...new Set([...MAJOR_COMPONENTS, ...components.map((component) => component.component)])];
}

function modelKey(row: UsageAdvisorRowDto): string {
  return `${usageProviderLabel(row.provider, row.model)} / ${row.model}`;
}

function modelLabel(row: UsageAdvisorRowDto): string {
  return modelKey(row);
}

function reliabilityText(row: UsageAdvisorRowDto | null): string {
  if (!row) return "unknown";
  if (row.reliability === "unknown") return "unknown";
  const known = row.successfulRuns + row.failedRuns + row.cancelledRuns;
  return `${percentage(row.successfulRuns, known)}% success`;
}

function percentage(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}
