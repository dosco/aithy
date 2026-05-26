import { useState } from "react";
import { Database, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clearTrainingData, exportTrainingData } from "@/server/actions.functions";
import type { TrainingDataSummaryDto } from "@/server/dto";

interface ExportedTrainingData {
  title: string;
  filename: string;
  openUrl: string;
}

export function TrainingDataPanel({
  stats,
  onStatsChange,
}: {
  stats: TrainingDataSummaryDto | null;
  onStatsChange: (stats: TrainingDataSummaryDto) => void;
}) {
  const [busy, setBusy] = useState<"sft" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<ExportedTrainingData | null>(null);
  const captureText = stats?.captureEnabled ? "capture on" : "capture off";

  async function runExport() {
    setBusy("sft");
    setError(null);
    try {
      const result = await exportTrainingData({ data: { format: "sft" } });
      setExported({
        title: result.title,
        filename: result.filename,
        openUrl: result.openUrl,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }

  async function clearAll() {
    if (!window.confirm("Delete local captured training data?")) return;
    setBusy("clear");
    setError(null);
    try {
      const result = await clearTrainingData({ data: { confirmation: "Yes, delete training data" } });
      onStatsChange(result.stats);
      setExported(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mb-6 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/35 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
            <Database className="h-3.5 w-3.5" /> training data
          </p>
          <p className="mt-2 max-w-xl text-sm text-[rgb(var(--muted-foreground))]">
            {captureText}; {stats?.traceCount.toLocaleString() ?? "0"} traces, {stats?.sessionCount.toLocaleString() ?? "0"} sessions. SFT export uses captured local traces only.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="soft" disabled={!stats?.sftExampleCount || busy !== null} onClick={() => void runExport()}>
            <Download className="h-4 w-4" /> SFT
          </Button>
          <Button type="button" size="sm" variant="danger" disabled={!stats?.traceCount || busy !== null} onClick={() => void clearAll()}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </div>
      {stats ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <MiniStat label={stats.byComponent[0]?.key ?? "components"} value={stats.byComponent[0]?.count ?? 0} detail="top component" />
          <MiniStat label={stats.byModel[0]?.key ?? "models"} value={stats.byModel[0]?.count ?? 0} detail="top model" />
          <MiniStat label={stats.bySession[0]?.key ?? "sessions"} value={stats.bySession[0]?.count ?? 0} detail="top session" />
        </div>
      ) : null}
      {exported ? (
        <p className="mt-4 text-xs text-[rgb(var(--muted-foreground))]">
          Exported <a className="underline underline-offset-4" href={exported.openUrl}>{exported.filename}</a>.
        </p>
      ) : null}
      {error ? <p className="mt-4 text-xs text-red-500">{error}</p> : null}
    </div>
  );
}

function MiniStat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="grid min-w-0 gap-1 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))]/40 p-3">
      <div className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
        {label}
      </div>
      <div className="text-2xl font-medium tabular-nums">{value.toLocaleString()}</div>
      <div className="text-[11px] text-[rgb(var(--muted-foreground))]">{detail}</div>
    </div>
  );
}
