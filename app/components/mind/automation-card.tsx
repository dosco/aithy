import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  Archive,
  BellRing,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Eye,
  Newspaper,
  Pause,
  Play,
  Repeat2,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AutomationDto } from "@/server/dto";
import { cn } from "@/lib/utils";

export interface AutomationForm {
  attentionType: AutomationDto["attentionType"];
  title: string;
  prompt: string;
  details: string;
  scheduleKind: string;
  time: string;
  dayOfWeek: string;
  everyMinutes: number;
  cronPattern: string;
  reminderAt: string;
  timezone: string;
  notificationPolicy: AutomationDto["notificationPolicy"];
  originSessionId: string;
  changeSchedule: boolean;
}

export const emptyAutomationForm: AutomationForm = {
  attentionType: "ritual",
  title: "",
  prompt: "",
  details: "",
  scheduleKind: "daily",
  time: "08:00",
  dayOfWeek: "1",
  everyMinutes: 60,
  cronPattern: "0 8 * * *",
  reminderAt: "",
  timezone: "",
  notificationPolicy: "attention_only",
  originSessionId: "",
  changeSchedule: true,
};

export function AutomationCard({
  entry,
  queued,
  onOpen,
  onRunNow,
  onPause,
  onResume,
  onArchive,
}: {
  entry: AutomationDto;
  queued: boolean;
  onOpen: () => void;
  onRunNow: () => void;
  onPause: () => void;
  onResume: () => void;
  onArchive: () => void;
}) {
  const latest = entry.recentRuns[0] ?? null;
  const runLabel = latest ? runSummary(latest.status) : "no runs yet";

  return (
    <motion.li layout transition={{ type: "spring", stiffness: 360, damping: 32 }}>
      <article
        className={cn(
          "group flex h-full min-h-[188px] flex-col overflow-hidden rounded-lg border bg-[rgb(var(--panel))] shadow-sm shadow-black/5 transition",
          "hover:-translate-y-0.5 hover:border-[rgb(var(--foreground))]/30 hover:shadow-md motion-reduce:hover:translate-y-0",
          statusBorder(entry.status),
        )}
      >
        <button type="button" className="flex min-h-0 flex-1 flex-col p-3 text-left sm:p-4" onClick={onOpen}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <TypePill type={entry.attentionType} />
                <StatusPill status={entry.status} />
              </div>
              <h3 className="mt-3 line-clamp-1 break-words text-base font-medium leading-snug sm:text-lg">
                {entry.title}
              </h3>
            </div>
          </div>

          <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-5 text-[rgb(var(--muted-foreground))]">
            {entry.prompt}
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <MetaPill>{entry.schedule}</MetaPill>
            <MetaPill>{policyLabel(entry.notificationPolicy)}</MetaPill>
            <MetaPill>{entry.timezone}</MetaPill>
          </div>

          <div className="mt-auto grid gap-1 pt-3 text-[11px] text-[rgb(var(--muted-foreground))] sm:grid-cols-2">
            <span>{entry.nextRunAt ? `next look ${relativeDate(entry.nextRunAt)}` : "not scheduled"}</span>
            <span>{entry.lastRunAt ? `last look ${relativeDate(entry.lastRunAt)}` : runLabel}</span>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2 border-t border-[rgb(var(--border))] px-3 py-2 sm:px-4">
          <Button asChild variant="ghost" size="sm" className="rounded-lg">
            <Link to="/chat/$sessionId" params={{ sessionId: entry.originSessionId }}>
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </Link>
          </Button>
          <Button type="button" variant="soft" size="sm" className="rounded-lg" onClick={onRunNow} disabled={queued}>
            <RotateCw className={cn("h-3.5 w-3.5", queued && "animate-spin")} />
            {queued ? "Queued" : "Look now"}
          </Button>
          {entry.status === "active" ? (
            <Button type="button" variant="soft" size="sm" className="rounded-lg" onClick={onPause}>
              <Pause className="h-3.5 w-3.5" /> Pause
            </Button>
          ) : (
            <Button type="button" variant="soft" size="sm" className="rounded-lg" onClick={onResume}>
              <Play className="h-3.5 w-3.5" /> Resume
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" className="ml-auto rounded-lg" onClick={onArchive}>
            <Archive className="h-3.5 w-3.5" />
            <span className="sr-only sm:not-sr-only">Archive</span>
          </Button>
        </div>
      </article>
    </motion.li>
  );
}

function StatusPill({ status }: { status: AutomationDto["status"] }) {
  const Icon = status === "needs_input" ? CircleAlert : status === "active" ? CheckCircle2 : Pause;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em]", statusTone(status))}>
      <Icon className="h-3 w-3" />
      {statusLabel(status)}
    </span>
  );
}

function TypePill({ type }: { type: AutomationDto["attentionType"] }) {
  const Icon = typeIcon(type);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--background))]/45 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--muted-foreground))]">
      <Icon className="h-3 w-3" />
      {attentionTypeLabel(type)}
    </span>
  );
}

function MetaPill({ children }: { children: string }) {
  return (
    <span className="max-w-full truncate rounded-full bg-[rgb(var(--muted))]/70 px-2 py-0.5 text-[11px] text-[rgb(var(--muted-foreground))]">
      {children}
    </span>
  );
}

function statusTone(status: AutomationDto["status"]): string {
  if (status === "active") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (status === "needs_input") return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (status === "paused") return "border-[rgb(var(--border))] bg-[rgb(var(--muted))]/55 text-[rgb(var(--muted-foreground))]";
  return "border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))]";
}

function statusBorder(status: AutomationDto["status"]): string {
  if (status === "needs_input") return "border-amber-500/35";
  if (status === "active") return "border-[rgb(var(--border))]";
  return "border-[rgb(var(--border))] opacity-90";
}

function policyLabel(policy: AutomationDto["notificationPolicy"]): string {
  if (policy === "always") return "notify always";
  if (policy === "failures_only") return "failures only";
  if (policy === "silent") return "silent";
  return "notify when useful";
}

function runSummary(status: AutomationDto["recentRuns"][number]["status"]): string {
  if (status === "completed") return "last look completed";
  if (status === "failed") return "last look failed";
  if (status === "running") return "running now";
  if (status === "queued") return "queued";
  return "last look cancelled";
}

function statusLabel(status: AutomationDto["status"]): string {
  if (status === "needs_input") return "Needs you";
  if (status === "paused") return "Resting";
  return status;
}

function attentionTypeLabel(type: AutomationDto["attentionType"]): string {
  if (type === "vigil") return "Vigil";
  if (type === "reminder") return "Reminder";
  if (type === "briefing") return "Briefing";
  return "Ritual";
}

function typeIcon(type: AutomationDto["attentionType"]) {
  if (type === "vigil") return Eye;
  if (type === "reminder") return BellRing;
  if (type === "briefing") return Newspaper;
  return Repeat2;
}

function relativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
