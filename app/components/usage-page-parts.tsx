import { cn } from "@/lib/utils";
import {
  PURPOSE_LABEL,
  PURPOSE_TINT,
  TOKEN_SEGMENTS,
  tokenValueFor,
  type DayStack,
  type ModelRow,
  type RangeTokenTotals,
} from "./usage-page-model";

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/40 p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--muted-foreground))]">
        {label}
      </div>
      <div className="min-w-0 text-2xl font-medium tabular-nums [overflow-wrap:anywhere]">{value}</div>
      {detail ? (
        <div className="text-[11px] text-[rgb(var(--muted-foreground))]">{detail}</div>
      ) : null}
    </div>
  );
}

export function TokenMix({ totals, days }: { totals: RangeTokenTotals; days: number }) {
  const total = Math.max(0, totals.totalTokens);
  const cacheTotal = totals.cacheCreationTokens + totals.cacheReadTokens;
  const cacheShareOfInput = totals.inputTokens === 0 ? 0 : Math.round((cacheTotal / totals.inputTokens) * 100);

  return (
    <div className="mb-6 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/35 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
            token mix · last {days}d
          </p>
          <p className="mt-2 max-w-xl text-sm text-[rgb(var(--muted-foreground))]">
            Input, output, and thinking tokens, with cache read/write overlaid on input.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-medium tabular-nums">{total.toLocaleString()}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
            total tokens
          </div>
        </div>
      </div>

      <TokenStack totals={totals} total={total} />
      <CacheInputBar totals={totals} />

      <div className="mt-4 grid gap-3 sm:grid-cols-5">
        {TOKEN_SEGMENTS.map((segment) => {
          const value = tokenValueFor(segment.key, totals);
          const share = total === 0 ? 0 : Math.round((value / total) * 100);
          return (
            <TokenStat
              key={segment.key}
              label={segment.label}
              value={value}
              share={`${share}% of total`}
              tint={segment.className}
            />
          );
        })}
        <TokenStat
          label="cache read"
          value={totals.cacheReadTokens}
          share={`${cacheShareOfInput}% input cached`}
          tint="bg-teal-500"
        />
        <TokenStat
          label="cache write"
          value={totals.cacheCreationTokens}
          share={`${formatTokenValue(cacheTotal)} cached`}
          tint="bg-cyan-300"
        />
      </div>
    </div>
  );
}

function TokenStack({ totals, total }: { totals: RangeTokenTotals; total: number }) {
  return (
    <div className="mt-4 h-3 overflow-hidden rounded bg-[rgb(var(--muted))]">
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
  );
}

function CacheInputBar({ totals }: { totals: RangeTokenTotals }) {
  const input = Math.max(1, totals.inputTokens);
  const readWidth = Math.min(100, (totals.cacheReadTokens / input) * 100);
  const creationWidth = Math.min(100 - readWidth, (totals.cacheCreationTokens / input) * 100);
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
        <span>input cache overlay</span>
        <span>{totals.inputTokens === 0 ? 0 : Math.round(((totals.cacheReadTokens + totals.cacheCreationTokens) / totals.inputTokens) * 100)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-sky-500/20">
        <div className="flex h-full">
          <div className="h-full bg-teal-500/80" style={{ width: `${readWidth}%` }} />
          <div className="h-full bg-cyan-300/80" style={{ width: `${creationWidth}%` }} />
        </div>
      </div>
    </div>
  );
}

function TokenStat({
  label,
  value,
  share,
  tint,
}: {
  label: string;
  value: number;
  share: string;
  tint: string;
}) {
  const displayValue = formatTokenValue(value);
  return (
    <div className="grid min-w-0 gap-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))]/40 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", tint)} />
        <span className="min-w-0 break-words font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
          {label}
        </span>
      </div>
      <div
        className="min-w-0 text-2xl font-medium leading-none tabular-nums [overflow-wrap:anywhere]"
        title={value.toLocaleString()}
      >
        {displayValue}
      </div>
      <div className="text-[11px] text-[rgb(var(--muted-foreground))]">{share}</div>
    </div>
  );
}

function formatTokenValue(value: number): string {
  if (Math.abs(value) < 1_000_000) return value.toLocaleString();
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    notation: "compact",
  }).format(value);
}

type UsageRangeDays = 7 | 14 | 30 | 60 | 90;

const RANGE_LABEL: Record<UsageRangeDays, string> = {
  7: "7D",
  14: "14D",
  30: "30D",
  60: "2M",
  90: "3M",
};

export function RangePicker({
  days,
  onChange,
}: {
  days: number;
  onChange: (d: UsageRangeDays) => void;
}) {
  const items: UsageRangeDays[] = [7, 14, 30, 60, 90];
  return (
    <div className="flex gap-1">
      {items.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={cn(
            "rounded border px-2.5 py-1 text-[11px] uppercase tracking-wide transition",
            days === d
              ? "border-[rgb(var(--foreground))] bg-[rgb(var(--foreground))] text-[rgb(var(--background))]"
              : "border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))] hover:text-[rgb(var(--foreground))]",
          )}
        >
          {RANGE_LABEL[d]}
        </button>
      ))}
    </div>
  );
}

export function DailyChart({ buckets }: { buckets: DayStack[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const width = 800;
  const height = 240;
  const padding = { top: 8, right: 0, bottom: 24, left: 0 };
  const chartH = height - padding.top - padding.bottom;
  const barWidth = (width - padding.left - padding.right) / buckets.length;
  const purposes = Array.from(new Set(buckets.flatMap((b) => Object.keys(b.byPurpose)))).sort();

  return (
    <div className="overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/40 p-4">
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
                  <rect key={p} x={x} y={yCursor} width={w} height={h} className={PURPOSE_TINT[p] ?? "fill-zinc-400"}>
                    <title>
                      {day.bucket} · {PURPOSE_LABEL[p] ?? p}: {value.toLocaleString()}
                    </title>
                  </rect>
                );
              })}
              <CacheOverlay day={day} max={max} x={x} width={w} bottom={padding.top + chartH} chartH={chartH} />
              {i % Math.max(1, Math.floor(buckets.length / 7)) === 0 ? (
                <text x={x + w / 2} y={height - 6} textAnchor="middle" className="fill-[rgb(var(--muted-foreground))] font-mono text-[9px]">
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

function CacheOverlay({
  day,
  max,
  x,
  width,
  bottom,
  chartH,
}: {
  day: DayStack;
  max: number;
  x: number;
  width: number;
  bottom: number;
  chartH: number;
}) {
  const cacheTotal = Math.min(day.total, day.cacheCreationTokens + day.cacheReadTokens);
  if (cacheTotal <= 0) return null;
  const overlayH = (cacheTotal / max) * chartH;
  const readH = overlayH * (day.cacheReadTokens / Math.max(1, day.cacheCreationTokens + day.cacheReadTokens));
  const creationH = overlayH - readH;
  const overlayX = x + width * 0.18;
  const overlayW = width * 0.64;
  return (
    <>
      <rect x={overlayX} y={bottom - readH} width={overlayW} height={readH} className="fill-teal-300 opacity-70">
        <title>
          {day.bucket} · cache read: {day.cacheReadTokens.toLocaleString()}
        </title>
      </rect>
      <rect x={overlayX} y={bottom - readH - creationH} width={overlayW} height={creationH} className="fill-cyan-100 opacity-70">
        <title>
          {day.bucket} · cache write: {day.cacheCreationTokens.toLocaleString()}
        </title>
      </rect>
    </>
  );
}

export function Legend({ purpose }: { purpose: string }) {
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

export function CacheLegend() {
  return (
    <>
      <div className="flex items-center gap-1.5 text-[11px] text-[rgb(var(--muted-foreground))]">
        <span className="h-2.5 w-2.5 rounded-sm bg-teal-300/80" />
        <span>cache read overlay</span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-[rgb(var(--muted-foreground))]">
        <span className="h-2.5 w-2.5 rounded-sm bg-cyan-100/80 ring-1 ring-[rgb(var(--border))]" />
        <span>cache write overlay</span>
      </div>
    </>
  );
}

export function ModelBreakdown({ rows }: { rows: ModelRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.totalTokens));
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[rgb(var(--border))] px-4 py-8 text-center text-xs text-[rgb(var(--muted-foreground))]">
        no model usage yet.
      </div>
    );
  }
  return (
    <ul className="grid gap-2">
      {rows.map((r) => {
        const cacheTotal = r.cacheCreationTokens + r.cacheReadTokens;
        const cacheShare = r.inputTokens === 0 ? 0 : Math.round((r.cacheReadTokens / r.inputTokens) * 100);
        return (
          <li key={`${r.provider}/${r.model}`} className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/40 px-4 py-3">
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
            <ModelUsageBar row={r} max={max} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[rgb(var(--muted-foreground))]">
              <span>{cacheTotal.toLocaleString()} cached</span>
              <span>{cacheShare}% input read from cache</span>
              <span>{r.cacheCreationTokens.toLocaleString()} written</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ModelUsageBar({ row, max }: { row: ModelRow; max: number }) {
  const totalWidth = (row.totalTokens / max) * 100;
  const cacheWidth = row.totalTokens === 0 ? 0 : ((row.cacheCreationTokens + row.cacheReadTokens) / row.totalTokens) * 100;
  return (
    <div className="mt-2 h-2 overflow-hidden rounded bg-[rgb(var(--muted))]">
      <div className="h-full bg-[rgb(var(--foreground))]/70" style={{ width: `${totalWidth}%` }}>
        <div className="h-full bg-teal-300/70" style={{ width: `${Math.min(100, cacheWidth)}%` }} />
      </div>
    </div>
  );
}
