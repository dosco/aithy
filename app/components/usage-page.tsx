import { useEffect, useMemo, useState } from "react";
import { PageFrame } from "@/components/page-frame";
import { ThemeSync } from "@/components/theme-sync";
import { getUsageStats } from "@/server/actions.functions";
import type { UsageBucketDto, UsagePageStateDto, UsageTotalsDto } from "@/server/dto";
import { groupByDay, groupByModel, summarizeTokenTotals } from "./usage-page-model";
import {
  CacheLegend,
  DailyChart,
  Legend,
  ModelBreakdown,
  RangePicker,
  Stat,
  TokenMix,
} from "./usage-page-parts";

export function UsagePage({ initialState }: { initialState: UsagePageStateDto }) {
  const [days, setDays] = useState<7 | 14 | 30 | 60 | 90>(30);
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
    <PageFrame eyebrow="Usage" title="tokens, cache hits, and model appetite.">
      <ThemeSync ui={initialState.settings.ui} />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
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
        {purposesPresent.length > 0 ? <CacheLegend /> : null}
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
