import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  PauseCircle,
  RotateCcw,
  Search,
  Square,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { ThemeSync } from "@/components/theme-sync";
import { useLiveEvent } from "@/components/live-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cancelTask, retryTask } from "@/server/actions.functions";
import type { TaskDto, TasksPageStateDto } from "@/server/dto";
import { cn } from "@/lib/utils";

type TaskTab = "active" | "attention" | "recent" | "all";
type Tone = "neutral" | "ok" | "busy" | "warn" | "bad";

const STATUS_OPTIONS = ["all", "planned", "running", "paused_approval", "failed", "completed", "cancelled"];
const KIND_OPTIONS = [
  "all",
  "chat.turn",
  "memory.auto",
  "memory.explicit",
  "memory.consolidate",
  "memory.expiry",
  "memory.dream",
  "skill.candidate",
  "skill.promote",
];

export function TasksPage({ initialState }: { initialState: TasksPageStateDto }) {
  const [tasks, setTasks] = useState(initialState.tasks);
  const [tab, setTab] = useState<TaskTab>("active");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [kind, setKind] = useState("all");

  useLiveEvent((event) => {
    if (event.type !== "task-status") return;
    setTasks((current) => upsertTask(current, event.task));
  });

  const counts = useMemo(() => taskCounts(tasks), [tasks]);
  const tabCounts = useMemo(() => ({
    active: tasks.filter(isActive).length,
    attention: tasks.filter(isAttention).length,
    recent: tasks.filter(isRecentSettled).length,
    all: tasks.length,
  }), [tasks]);
  const tabTasks = useMemo(() => tasksForTab(tasks, tab), [tasks, tab]);
  const visibleTasks = useMemo(
    () => tabTasks.filter((task) => matchesTask(task, query, status, kind)),
    [tabTasks, query, status, kind],
  );

  return (
    <PageFrame eyebrow="Work" title="Tasks">
      <ThemeSync ui={initialState.settings.ui} />
      <div className="space-y-5">
        <TaskStatusPanel counts={counts} />
        <Tabs value={tab} onValueChange={(value) => setTab(value as TaskTab)}>
          <TabsList className="flex w-full flex-wrap justify-start rounded-lg bg-[rgb(var(--panel)/0.76)] font-mono">
            <TaskTabTrigger value="active" count={tabCounts.active} />
            <TaskTabTrigger value="attention" count={tabCounts.attention} />
            <TaskTabTrigger value="recent" count={tabCounts.recent} />
            <TaskTabTrigger value="all" count={tabCounts.all} />
          </TabsList>
          <TaskFilters
            query={query}
            status={status}
            kind={kind}
            count={`${visibleTasks.length}/${tabTasks.length}`}
            onQueryChange={setQuery}
            onStatusChange={setStatus}
            onKindChange={setKind}
          />
          <TabsContent value={tab} forceMount>
            <TaskPanel title={panelTitle(tab)} live={counts.active > 0}>
              {visibleTasks.length ? visibleTasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              )) : (
                <EmptyRow label={emptyLabel(tab, tabTasks.length)} />
              )}
            </TaskPanel>
          </TabsContent>
        </Tabs>
      </div>
    </PageFrame>
  );
}

function TaskStatusPanel({ counts }: { counts: ReturnType<typeof taskCounts> }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[rgb(var(--accent)/0.36)] bg-[rgb(var(--panel)/0.82)] shadow-[0_0_0_1px_rgb(var(--foreground)/0.05),0_24px_80px_rgb(0_0_0/0.14)]">
      <div className="flex items-center justify-between border-b border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.42)] px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
          aithy@work: /tasks
        </div>
      </div>
      <div className="relative overflow-hidden p-4 sm:p-5">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgb(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--foreground)) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative">
          <div className="font-mono text-xs text-[rgb(var(--accent))]">
            <span className="text-[rgb(var(--muted-foreground))]">$</span> aithyctl tasks --watch
            {counts.active ? <span className="ml-1 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-[rgb(var(--accent))]" /> : null}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <TaskMetric icon={Activity} label="active" value={counts.active.toString()} tone={counts.active ? "busy" : "neutral"} />
            <TaskMetric icon={PauseCircle} label="paused" value={counts.paused.toString()} tone={counts.paused ? "warn" : "neutral"} />
            <TaskMetric icon={CircleAlert} label="failed" value={counts.failed.toString()} tone={counts.failed ? "bad" : "ok"} />
            <TaskMetric icon={CheckCircle2} label="settled" value={counts.settled.toString()} tone="ok" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskMetric({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.46)] px-3 py-2">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={cn("mt-2 font-mono text-2xl", toneText(tone))}>{value}</div>
    </div>
  );
}

function TaskTabTrigger({ value, count }: { value: TaskTab; count: number }) {
  return (
    <TabsTrigger className="inline-flex items-center gap-2 rounded-md font-mono" value={value}>
      {value}
      <span className="rounded border border-current/30 px-1.5 text-[10px]">{count}</span>
    </TabsTrigger>
  );
}

function TaskFilters({
  query,
  status,
  kind,
  count,
  onQueryChange,
  onStatusChange,
  onKindChange,
}: {
  query: string;
  status: string;
  kind: string;
  count: string;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onKindChange: (value: string) => void;
}) {
  return (
    <div className="mt-4 grid gap-2 lg:grid-cols-[1fr_auto_auto_auto]">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted-foreground))]" />
        <Input
          className="h-10 rounded-lg bg-[rgb(var(--panel)/0.74)] pl-9 font-mono text-xs"
          placeholder="grep tasks, ids, sessions"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <FilterSelect label="status" value={status} options={STATUS_OPTIONS} onChange={onStatusChange} />
      <FilterSelect label="kind" value={kind} options={KIND_OPTIONS} onChange={onKindChange} />
      <div className="flex h-10 items-center rounded-lg border border-[rgb(var(--border))] px-3 font-mono text-xs text-[rgb(var(--muted-foreground))]">
        {count}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.74)] px-3 font-mono text-xs text-[rgb(var(--muted-foreground))]">
      {label}
      <select
        className="max-w-[11rem] bg-transparent text-[rgb(var(--foreground))] outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function TaskPanel({ title, live, children }: { title: string; live: boolean; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.72)]">
      <div className="flex items-center justify-between border-b border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.34)] px-3 py-2">
        <div className="font-mono text-xs text-[rgb(var(--accent))]">
          <span className="text-[rgb(var(--muted-foreground))]">$</span> {title}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
          {live ? "live" : "idle"}
        </div>
      </div>
      <div className="divide-y divide-[rgb(var(--border)/0.72)]">{children}</div>
    </div>
  );
}

function TaskRow({ task }: { task: TaskDto }) {
  return (
    <div className="grid gap-2 px-3 py-3 md:grid-cols-[5.5rem_9.5rem_8rem_4.5rem_1fr_auto] md:items-center">
      <MutedCell>{formatTime(task.updatedAt)}</MutedCell>
      <MonoCell>{task.kind}</MonoCell>
      <StatusPill status={task.status} />
      <MutedCell>try {task.attempt}</MutedCell>
      <div className="min-w-0">
        <div className="min-w-0 break-words text-sm font-medium leading-6">{task.title}</div>
        <div className="min-w-0 break-words text-xs leading-5 text-[rgb(var(--muted-foreground))]">
          {taskMessage(task)}
        </div>
        <TaskMeta task={task} />
      </div>
      <TaskActions task={task} />
    </div>
  );
}

function TaskActions({ task }: { task: TaskDto }) {
  return (
    <div className="flex flex-wrap items-center gap-2 md:justify-end">
      {task.relatedSessionId ? (
        <Button asChild variant="soft" size="sm" className="h-8 rounded-md px-2.5 font-mono text-xs">
          <Link to="/chat/$sessionId" params={{ sessionId: task.relatedSessionId }}>
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </Link>
        </Button>
      ) : null}
      {task.canRetry ? (
        <Button
          variant="soft"
          size="sm"
          className="h-8 rounded-md px-2.5 font-mono text-xs"
          onClick={() => void retryTask({ data: { taskId: task.id } })}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Retry
        </Button>
      ) : null}
      {task.canCancel ? (
        <Button
          variant="soft"
          size="sm"
          className="h-8 rounded-md px-2.5 font-mono text-xs"
          onClick={() => void cancelTask({ data: { taskId: task.id } })}
        >
          <Square className="h-3.5 w-3.5" /> Stop
        </Button>
      ) : null}
    </div>
  );
}

function TaskMeta({ task }: { task: TaskDto }) {
  const items = [
    ["id", task.id],
    ["session", task.relatedSessionId],
    ["cmd", task.runtimeCommandId],
    ["queue", task.queueJobId],
    ["memory", task.memoryRunId],
    ["skill", task.skillCandidateId],
    ["permit", task.permissionRequestId],
    ["retry", task.retryOfTaskId],
    ["created", formatTimestamp(task.createdAt)],
    task.startedAt ? ["started", formatTimestamp(task.startedAt)] : null,
    task.completedAt ? ["done", formatTimestamp(task.completedAt)] : null,
  ].filter((item): item is [string, string] => Boolean(item?.[1]));

  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-[rgb(var(--muted-foreground))]">
      {items.map(([label, value]) => (
        <span key={`${label}-${value}`} className="min-w-0 truncate">
          {label}:{label === "created" || label === "started" || label === "done" ? value : shortId(value)}
        </span>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: TaskDto["status"] }) {
  return (
    <span className={cn("w-fit rounded border px-2 py-0.5 font-mono text-[11px] uppercase", statusTone(status))}>
      {status.replace("_", " ")}
    </span>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="px-3 py-10 text-center font-mono text-xs text-[rgb(var(--muted-foreground))]">
      {label}
    </div>
  );
}

function MonoCell({ children }: { children: ReactNode }) {
  return <span className="min-w-0 truncate font-mono text-xs">{children}</span>;
}

function MutedCell({ children }: { children: ReactNode }) {
  return <span className="min-w-0 truncate font-mono text-xs text-[rgb(var(--muted-foreground))]">{children}</span>;
}

function upsertTask(tasks: TaskDto[], task: TaskDto): TaskDto[] {
  const next = [task, ...tasks.filter((item) => item.id !== task.id)];
  return next.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 100);
}

function taskCounts(tasks: TaskDto[]) {
  return {
    active: tasks.filter(isActive).length,
    paused: tasks.filter((task) => task.status === "paused_approval").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    settled: tasks.filter((task) => task.status === "completed" || task.status === "cancelled").length,
  };
}

function tasksForTab(tasks: TaskDto[], tab: TaskTab): TaskDto[] {
  if (tab === "active") return tasks.filter(isActive);
  if (tab === "attention") return tasks.filter(isAttention);
  if (tab === "recent") return tasks.filter(isRecentSettled);
  return tasks;
}

function matchesTask(task: TaskDto, query: string, status: string, kind: string): boolean {
  if (status !== "all" && task.status !== status) return false;
  if (kind !== "all" && task.kind !== kind) return false;
  return containsQuery(query, [
    task.id,
    task.title,
    task.kind,
    task.status,
    task.reason,
    task.resultSummary,
    task.errorSummary,
    task.conversationId,
    task.relatedSessionId,
    task.runtimeCommandId,
    task.queueJobId,
    task.memoryRunId,
    task.skillCandidateId,
    task.permissionRequestId,
    task.retryOfTaskId,
  ]);
}

function containsQuery(query: string, values: Array<string | null>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

function isActive(task: TaskDto): boolean {
  return task.status === "planned" || task.status === "running" || task.status === "paused_approval";
}

function isAttention(task: TaskDto): boolean {
  return task.status === "failed" || task.status === "paused_approval";
}

function isRecentSettled(task: TaskDto): boolean {
  return task.status === "completed" || task.status === "cancelled";
}

function taskMessage(task: TaskDto): string {
  if (task.status === "failed") return task.errorSummary ?? task.reason ?? "Failed without details.";
  if (task.status === "completed") return task.resultSummary ?? task.reason ?? "Completed.";
  return task.reason ?? "Task is updating.";
}

function panelTitle(tab: TaskTab): string {
  if (tab === "active") return "tasks --active";
  if (tab === "attention") return "tasks --attention";
  if (tab === "recent") return "tasks --settled";
  return "tasks --all";
}

function emptyLabel(tab: TaskTab, total: number): string {
  if (total > 0) return "no tasks match filter";
  if (tab === "active") return "no active tasks";
  if (tab === "attention") return "no paused approvals or failed tasks";
  if (tab === "recent") return "no completed or cancelled tasks";
  return "no task history yet";
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function statusTone(status: TaskDto["status"]): string {
  if (status === "completed") return "border-[rgb(var(--accent)/0.42)] bg-[rgb(var(--accent)/0.12)] text-[rgb(var(--accent))]";
  if (status === "failed") return "border-[rgb(var(--danger)/0.42)] bg-[rgb(var(--danger)/0.12)] text-[rgb(var(--danger))]";
  if (status === "cancelled") return "border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))]";
  if (status === "paused_approval") return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-sky-500/35 bg-sky-500/10 text-sky-600 dark:text-sky-300";
}

function toneText(tone: Tone): string {
  if (tone === "ok") return "text-[rgb(var(--accent))]";
  if (tone === "busy") return "text-sky-500 dark:text-sky-300";
  if (tone === "warn") return "text-amber-700 dark:text-amber-300";
  if (tone === "bad") return "text-[rgb(var(--danger))]";
  return "text-[rgb(var(--foreground))]";
}
