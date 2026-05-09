import { useEffect, useMemo, useState } from "react";
import { PageFrame } from "@/components/page-frame";
import { ThemeSync } from "@/components/theme-sync";
import { cn } from "@/lib/utils";
import { getUsageStats } from "@/server/actions.functions";
import type { UsageBucketDto, UsageTotalsDto, WebStateDto } from "@/server/dto";

const PURPOSE_TINT: Record<string, string> = {
  chat: "fill-sky-500",
  "memory.triage": "fill-violet-500",
  "memory.consolidate": "fill-emerald-500",
  "skill.promote": "fill-amber-500",
  other: "fill-zinc-500",
};

const PURPOSE_LABEL: Record<string, string> = {
  chat: "chat",
  "memory.triage": "memory triage",
  "memory.consolidate": "memory consolidate",
  "skill.promote": "skill promote",
  other: "other",
};

const TOKEN_SEGMENTS = [
  { key: "input", label: "input", className: "bg-sky-500" },
  { key: "output", label: "output", className: "bg-amber-500" },
  { key: "thought", label: "thinking", className: "bg-violet-500" },
] as const;

export function UsagePage({ initialState }: { initialState: WebStateDto }) {
  const [days, setDays] = useState<7 | 14 | 30>(30);
  const [buckets, setBuckets] = useState<UsageBucketDto[]>([]);
  const [totals, setTotals] = useState<UsageTotalsDto>({
    callsAllTime: 0,
    tokensAllTime: 0,
    tokensLast24h: 0,
    tokensLast7d: 0,
  });

  useEffect(() => {
    let cancelled = false;
    void getUsageStats({ data: { days } }).then((r) => {
      if (cancelled) return;
      setBuckets(r.buckets);
      setTotals(r.totals);
    });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const byDay = useMemo(() => groupByDay(buckets, days), [buckets, days]);
  const byModel = useMemo(() => groupByModel(buckets), [buckets]);
  const tokenTotals = useMemo(() => summarizeTokenTotals(buckets), [buckets]);
  const purposesPresent = useMemo(() => {
    const set = new Set<string>();
    for (const b of buckets) set.add(b.purpose);
    return [...set];
  }, [buckets]);

  return (
    <PageFrame eyebrow="Usage" title="how many tokens i've burned.">
      <ThemeSync ui={initialState.settings.ui} />

      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Stat label="Calls (all time)" value={totals.callsAllTime.toLocaleString()} />
        <Stat label="Tokens (all time)" value={totals.tokensAllTime.toLocaleString()} />
        <Stat label="Last 24h" value={totals.tokensLast24h.toLocaleString()} />
        <Stat label="Last 7d" value={totals.tokensLast7d.toLocaleString()} />
      </div>

      <TokenMix totals={tokenTotals} days={days} />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
          Tokens per day · stacked by purpose
        </h2>
        <RangePicker days={days} onChange={setDays} />
      </div>

      <DailyChart buckets={byDay} />

      <div className="mt-3 flex flex-wrap gap-3">
        {purposesPresent.map((purpose) => (
          <Legend key={purpose} purpose={purpose} />
        ))}
        {purposesPresent.length === 0 ? (
          <span className="text-xs text-[rgb(var(--muted-foreground))]">
            no usage yet — send a chat message to start filling this in.
          </span>
        ) : null}
      </div>

      <h2 className="mb-3 mt-10 font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
        By model
      </h2>
      <ModelBreakdown rows={byModel} />
    </PageFrame>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/40 p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--muted-foreground))]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-medium tabular-nums">{value}</div>
    </div>
  );
}

interface RangeTokenTotals {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

function summarizeTokenTotals(rows: UsageBucketDto[]): RangeTokenTotals {
  const totals: RangeTokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    totalTokens: 0,
  };
  for (const row of rows) {
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.thoughtTokens += row.thoughtTokens;
    totals.totalTokens += row.totalTokens;
  }
  return totals;
}

function TokenMix({ totals, days }: { totals: RangeTokenTotals; days: number }) {
  const total = Math.max(0, totals.totalTokens);

  return (
    <div className="mb-6 rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/35 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
            token mix · last {days}d
          </p>
          <p className="mt-2 max-w-xl text-sm text-[rgb(var(--muted-foreground))]">
            Input, output, and thinking tokens broken out for the selected window.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-medium tabular-nums">{total.toLocaleString()}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
            total tokens
          </div>
        </div>
      </div>

      <div className="mt-4 h-3 overflow-hidden rounded-full bg-[rgb(var(--muted))]">
        <div className="flex h-full w-full">
          {TOKEN_SEGMENTS.map((segment) => {
            const value = tokenValueFor(segment.key, totals);
            const width = total === 0 ? 0 : (value / total) * 100;
            return (
              <div
                key={segment.key}
                className={cn("h-full", segment.className)}
                style={{ width: `${width}%` }}
                aria-label={`${segment.label} tokens`}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {TOKEN_SEGMENTS.map((segment) => {
          const value = tokenValueFor(segment.key, totals);
          const share = total === 0 ? 0 : Math.round((value / total) * 100);
          return (
            <TokenStat
              key={segment.key}
              label={segment.label}
              value={value}
              share={share}
              tint={segment.className}
            />
          );
        })}
      </div>
    </div>
  );
}

function tokenValueFor(
  key: "input" | "output" | "thought",
  totals: RangeTokenTotals,
): number {
  if (key === "input") return totals.inputTokens;
  if (key === "output") return totals.outputTokens;
  return totals.thoughtTokens;
}

function TokenStat({
  label,
  value,
  share,
  tint,
}: {
  label: string;
  value: number;
  share: number;
  tint: string;
}) {
  return (
    <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--background))]/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", tint)} />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
            {label}
          </span>
        </div>
        <span className="tabular-nums text-sm">{value.toLocaleString()}</span>
      </div>
      <div className="mt-2 text-[11px] text-[rgb(var(--muted-foreground))]">
        {share}% of selected tokens
      </div>
    </div>
  );
}

function RangePicker({ days, onChange }: { days: number; onChange: (d: 7 | 14 | 30) => void }) {
  const items: Array<7 | 14 | 30> = [7, 14, 30];
  return (
    <div className="flex gap-1">
      {items.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wide transition",
            days === d
              ? "border-[rgb(var(--foreground))] bg-[rgb(var(--foreground))] text-[rgb(var(--background))]"
              : "border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))] hover:text-[rgb(var(--foreground))]",
          )}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

interface DayStack {
  bucket: string;
  byPurpose: Record<string, number>;
  total: number;
}

function groupByDay(rows: UsageBucketDto[], days: number): DayStack[] {
  const map = new Map<string, DayStack>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    map.set(d, { bucket: d, byPurpose: {}, total: 0 });
  }
  for (const r of rows) {
    const day = map.get(r.bucket);
    if (!day) continue;
    day.byPurpose[r.purpose] = (day.byPurpose[r.purpose] ?? 0) + r.totalTokens;
    day.total += r.totalTokens;
  }
  return [...map.values()];
}

function DailyChart({ buckets }: { buckets: DayStack[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const width = 800;
  const height = 240;
  const padding = { top: 8, right: 0, bottom: 24, left: 0 };
  const chartH = height - padding.top - padding.bottom;
  const barWidth = (width - padding.left - padding.right) / buckets.length;
  const purposes = Array.from(
    new Set(buckets.flatMap((b) => Object.keys(b.byPurpose))),
  ).sort();

  return (
    <div className="overflow-hidden rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/40 p-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Daily token usage"
      >
        {buckets.map((day, i) => {
          const x = padding.left + i * barWidth + barWidth * 0.1;
          const w = barWidth * 0.8;
          let yCursor = padding.top + chartH;
          return (
            <g key={day.bucket}>
              {purposes.map((p) => {
                const value = day.byPurpose[p] ?? 0;
                if (value === 0) return null;
                const h = (value / max) * chartH;
                yCursor -= h;
                return (
                  <rect
                    key={p}
                    x={x}
                    y={yCursor}
                    width={w}
                    height={h}
                    className={PURPOSE_TINT[p] ?? "fill-zinc-400"}
                    rx={2}
                  >
                    <title>
                      {day.bucket} · {PURPOSE_LABEL[p] ?? p}: {value.toLocaleString()}
                    </title>
                  </rect>
                );
              })}
              {i % Math.max(1, Math.floor(buckets.length / 7)) === 0 ? (
                <text
                  x={x + w / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-[rgb(var(--muted-foreground))] font-mono text-[9px]"
                >
                  {day.bucket.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Legend({ purpose }: { purpose: string }) {
  const tint = PURPOSE_TINT[purpose] ?? "fill-zinc-400";
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-[rgb(var(--muted-foreground))]">
      <svg width="10" height="10" className="shrink-0" aria-hidden>
        <rect width="10" height="10" rx="2" className={tint} />
      </svg>
      <span>{PURPOSE_LABEL[purpose] ?? purpose}</span>
    </div>
  );
}

interface ModelRow {
  provider: string;
  model: string;
  totalTokens: number;
  calls: number;
}

function groupByModel(rows: UsageBucketDto[]): ModelRow[] {
  const map = new Map<string, ModelRow>();
  for (const r of rows) {
    const key = `${r.provider}/${r.model}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalTokens += r.totalTokens;
      existing.calls += r.calls;
    } else {
      map.set(key, {
        provider: r.provider,
        model: r.model,
        totalTokens: r.totalTokens,
        calls: r.calls,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens);
}

function ModelBreakdown({ rows }: { rows: ModelRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.totalTokens));
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[rgb(var(--border))] px-4 py-8 text-center text-xs text-[rgb(var(--muted-foreground))]">
        no model usage yet.
      </div>
    );
  }
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li
          key={`${r.provider}/${r.model}`}
          className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/40 px-4 py-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{r.model}</div>
              <div className="font-mono text-[10px] uppercase tracking-wide text-[rgb(var(--muted-foreground))]">
                {r.provider}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm tabular-nums">{r.totalTokens.toLocaleString()}</div>
              <div className="font-mono text-[10px] uppercase tracking-wide text-[rgb(var(--muted-foreground))]">
                {r.calls} call{r.calls === 1 ? "" : "s"}
              </div>
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgb(var(--muted))]">
            <div
              className="h-full bg-[rgb(var(--foreground))]/70"
              style={{ width: `${(r.totalTokens / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
