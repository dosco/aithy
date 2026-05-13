import { useMemo, useState, type ReactNode } from "react";
import { Activity, Circle, HardDrive, ListTree, RadioTower } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  RuntimeCommandDto,
  RuntimeConsoleDto,
  RuntimeLogDto,
  RuntimeServiceDto,
} from "@/server/runtime-console.dto";
import { ConsoleFilters, LoadMoreRow } from "./console-filters";
import { useRuntimeConsole } from "./use-runtime-console";

const DEFAULT_LIMIT = 120;
const LIMIT_STEP = 120;
const MAX_LIMIT = 1000;

export function ConsolePage({ initialState }: { initialState: RuntimeConsoleDto }) {
  const [logLimit, setLogLimit] = useState(DEFAULT_LIMIT);
  const [commandLimit, setCommandLimit] = useState(DEFAULT_LIMIT);
  const [logQuery, setLogQuery] = useState("");
  const [logLevel, setLogLevel] = useState("all");
  const [commandQuery, setCommandQuery] = useState("");
  const [commandStatus, setCommandStatus] = useState("all");
  const state = useRuntimeConsole(initialState, { logLimit, commandLimit });
  const logs = collapseAdjacentLogs(state.logs);
  const visibleLogs = useMemo(
    () => logs.filter((log) => matchesLog(log, logQuery, logLevel)),
    [logs, logQuery, logLevel],
  );
  const visibleCommands = useMemo(
    () => state.commands.filter((command) => matchesCommand(command, commandQuery, commandStatus)),
    [state.commands, commandQuery, commandStatus],
  );
  const healthyServices = state.services.filter((service) => service.state === "ready").length;
  const activeCommands = state.commands.filter((command) => command.status === "pending" || command.status === "claimed").length;
  const queueDepth = state.queues.reduce((sum, queue) => sum + (queue.depth ?? 0), 0);
  const errorLogs = logs.filter((log) => log.level === "error").length;
  const canLoadLogs = state.logs.length >= logLimit && logLimit < MAX_LIMIT;
  const canLoadCommands = state.commands.length >= commandLimit && commandLimit < MAX_LIMIT;

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-lg border border-[rgb(var(--accent)/0.36)] bg-[rgb(var(--panel)/0.82)] shadow-[0_0_0_1px_rgb(var(--foreground)/0.05),0_24px_80px_rgb(0_0_0/0.18)]">
        <div className="flex items-center justify-between border-b border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.42)] px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
            aithy@runtime: /var/log
          </div>
        </div>

        <div className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "linear-gradient(rgb(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--foreground)) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />
          <div className="relative p-4 sm:p-5">
            <div className="grid gap-3 lg:grid-cols-[1.3fr_0.7fr]">
              <div className="min-w-0">
                <div className="font-mono text-xs text-[rgb(var(--accent))]">
                  <span className="text-[rgb(var(--muted-foreground))]">$</span> aithyctl status --watch
                  <span className="ml-1 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-[rgb(var(--accent))]" />
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <ConsoleMetric icon={RadioTower} label="services" value={`${healthyServices}/${state.services.length}`} />
                  <ConsoleMetric icon={Activity} label="commands" value={activeCommands.toString()} />
                  <ConsoleMetric icon={ListTree} label="queue depth" value={queueDepth.toString()} />
                  <ConsoleMetric icon={HardDrive} label="errors" value={errorLogs.toString()} tone={errorLogs ? "bad" : "ok"} />
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {state.services.map((service) => (
                  <ServiceStatus key={service.role} service={service} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="logs">
        <TabsList className="rounded-lg bg-[rgb(var(--panel)/0.76)] font-mono">
          <TabsTrigger className="rounded-md" value="logs">logs</TabsTrigger>
          <TabsTrigger className="rounded-md" value="services">ps</TabsTrigger>
          <TabsTrigger className="rounded-md" value="commands">jobs</TabsTrigger>
          <TabsTrigger className="rounded-md" value="queues">queues</TabsTrigger>
        </TabsList>

        <TabsContent value="logs">
          <ConsoleFilters
            query={logQuery}
            onQueryChange={setLogQuery}
            queryPlaceholder="grep logs, roles, sources"
            selectLabel="level"
            selectValue={logLevel}
            onSelectChange={setLogLevel}
            options={["all", "debug", "info", "warn", "error"]}
            count={`${visibleLogs.length}/${state.logs.length}`}
          />
          <TerminalPanel title={`tail -n ${logLimit} runtime.log`}>
            {visibleLogs.length ? visibleLogs.map((log) => (
              <LogRow key={`${log.id}-${log.createdAt}`} log={log} />
            )) : <EmptyRow label={state.logs.length ? "no logs match filter" : "no log entries"} />}
            <LoadMoreRow
              hasMore={canLoadLogs}
              label={canLoadLogs ? "scroll to read older logs" : `loaded ${state.logs.length} logs`}
              onLoadMore={() => setLogLimit((limit) => nextLimit(limit))}
            />
          </TerminalPanel>
        </TabsContent>

        <TabsContent value="services">
          <TerminalPanel title="ps -o role,state,pid,detail">
            {state.services.map((service) => (
              <DataRow key={service.role} columns="md:grid-cols-[12rem_8rem_7rem_1fr]">
                <MonoCell>{service.role}</MonoCell>
                <StatePill label={service.state} tone={toneForState(service.state)} />
                <MutedCell>{service.pid ? `pid ${service.pid}` : "no pid"}</MutedCell>
                <MutedCell truncate>{detailText(service.detail) || formatTimestamp(service.lastSeenAt)}</MutedCell>
              </DataRow>
            ))}
          </TerminalPanel>
        </TabsContent>

        <TabsContent value="commands">
          <ConsoleFilters
            query={commandQuery}
            onQueryChange={setCommandQuery}
            queryPlaceholder="grep jobs, ids, targets"
            selectLabel="status"
            selectValue={commandStatus}
            onSelectChange={setCommandStatus}
            options={["all", "pending", "claimed", "completed", "failed"]}
            count={`${visibleCommands.length}/${state.commands.length}`}
          />
          <TerminalPanel title={`jobs --recent ${commandLimit}`}>
            {visibleCommands.length ? visibleCommands.map((command) => (
              <CommandRow key={command.id} command={command} />
            )) : <EmptyRow label={state.commands.length ? "no jobs match filter" : "no command history"} />}
            <LoadMoreRow
              hasMore={canLoadCommands}
              label={canLoadCommands ? "scroll to read older jobs" : `loaded ${state.commands.length} jobs`}
              onLoadMore={() => setCommandLimit((limit) => nextLimit(limit))}
            />
          </TerminalPanel>
        </TabsContent>

        <TabsContent value="queues">
          <TerminalPanel title="queuectl ls">
            {state.queues.length ? state.queues.map((queue) => (
              <DataRow key={queue.id} columns="md:grid-cols-[10rem_12rem_7rem_1fr]">
                <MonoCell>{queue.id}</MonoCell>
                <MutedCell>{queue.ownerRole}</MutedCell>
                <StatePill label={queue.state} tone={toneForState(queue.state)} />
                <MutedCell truncate>
                  {queue.blockedReason ?? `depth ${queue.depth ?? 0} / active ${queue.activeCount ?? 0}`}
                </MutedCell>
              </DataRow>
            )) : <EmptyRow label="no queues" />}
          </TerminalPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface CollapsedLog extends RuntimeLogDto {
  repeatCount: number;
}

function ConsoleMetric({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "bad";
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.46)] px-3 py-2">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={cn("mt-2 font-mono text-2xl", metricTone(tone))}>{value}</div>
    </div>
  );
}

function ServiceStatus({ service }: { service: RuntimeServiceDto }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.44)] px-3 py-2">
      <Circle className={cn("h-2.5 w-2.5 fill-current", dotTone(toneForState(service.state)))} />
      <div className="min-w-0">
        <div className="truncate font-mono text-xs">{service.role}</div>
        <div className="truncate text-[11px] text-[rgb(var(--muted-foreground))]">
          {detailText(service.detail) || formatTimestamp(service.lastSeenAt)}
        </div>
      </div>
      <StatePill label={service.state} tone={toneForState(service.state)} />
    </div>
  );
}

function TerminalPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.72)]">
      <div className="flex items-center justify-between border-b border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.34)] px-3 py-2">
        <div className="font-mono text-xs text-[rgb(var(--accent))]">
          <span className="text-[rgb(var(--muted-foreground))]">$</span> {title}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
          live
        </div>
      </div>
      <div className="divide-y divide-[rgb(var(--border)/0.72)]">{children}</div>
    </div>
  );
}

function LogRow({ log }: { log: CollapsedLog }) {
  return (
    <DataRow columns="md:grid-cols-[5.5rem_9rem_7rem_1fr_4rem]">
      <MutedCell>{formatTime(log.createdAt)}</MutedCell>
      <MonoCell>{log.role}</MonoCell>
      <span className={cn("font-mono text-xs uppercase", logLevelTone(log.level))}>{log.level}</span>
      <span className="min-w-0 break-words text-sm leading-6">
        {log.message}
        {log.repeatCount > 1 ? (
          <span className="ml-2 rounded border border-[rgb(var(--border))] px-1.5 py-0.5 font-mono text-[10px] text-[rgb(var(--muted-foreground))]">
            x{log.repeatCount}
          </span>
        ) : null}
      </span>
      <MutedCell>{log.source ? `src:${log.source}` : "-"}</MutedCell>
    </DataRow>
  );
}

function CommandRow({ command }: { command: RuntimeCommandDto }) {
  return (
    <DataRow columns="md:grid-cols-[12rem_13rem_8rem_1fr]">
      <MutedCell truncate>{command.id}</MutedCell>
      <MonoCell>{command.kind}</MonoCell>
      <StatePill label={command.status} tone={toneForState(command.status)} />
      <MutedCell truncate>{detailText(command.detail) || command.targetRole}</MutedCell>
    </DataRow>
  );
}

function DataRow({
  columns,
  children,
}: {
  columns: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-2 px-3 py-2.5 md:items-center", columns)}>
      {children}
    </div>
  );
}

function MonoCell({ children }: { children: ReactNode }) {
  return <span className="min-w-0 truncate font-mono text-xs">{children}</span>;
}

function MutedCell({ children, truncate = false }: { children: ReactNode; truncate?: boolean }) {
  return (
    <span className={cn("min-w-0 font-mono text-xs text-[rgb(var(--muted-foreground))]", truncate && "truncate")}>
      {children}
    </span>
  );
}

function StatePill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className={cn("w-fit rounded border px-2 py-0.5 font-mono text-[11px] uppercase", pillTone(tone))}>
      {label}
    </span>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div className="px-3 py-8 text-center font-mono text-xs text-[rgb(var(--muted-foreground))]">
      {label}
    </div>
  );
}

function collapseAdjacentLogs(logs: RuntimeLogDto[]): CollapsedLog[] {
  const collapsed: CollapsedLog[] = [];
  for (const log of logs) {
    const previous = collapsed.at(-1);
    if (previous && logKey(previous) === logKey(log)) {
      previous.repeatCount += 1;
      continue;
    }
    collapsed.push({ ...log, repeatCount: 1 });
  }
  return collapsed;
}

function logKey(log: RuntimeLogDto): string {
  return `${log.role}\0${log.level}\0${log.source ?? ""}\0${log.message}`;
}

function detailText(detail: unknown): string {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
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

function matchesLog(log: CollapsedLog, query: string, level: string): boolean {
  if (level !== "all" && log.level !== level) return false;
  return containsQuery(query, [log.role, log.level, log.source, log.message, detailText(log.detail)]);
}

function matchesCommand(command: RuntimeCommandDto, query: string, status: string): boolean {
  if (status !== "all" && command.status !== status) return false;
  return containsQuery(query, [
    command.id,
    command.kind,
    command.status,
    command.targetRole,
    detailText(command.detail),
  ]);
}

function containsQuery(query: string, values: Array<string | undefined>): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

function nextLimit(limit: number): number {
  return Math.min(limit + LIMIT_STEP, MAX_LIMIT);
}

type Tone = "neutral" | "ok" | "busy" | "warn" | "bad";

function toneForState(state: string): Tone {
  if (state === "ready" || state === "completed" || state === "idle") return "ok";
  if (state === "busy" || state === "running" || state === "claimed") return "busy";
  if (state === "starting" || state === "pending" || state === "paused" || state === "stopping") return "warn";
  if (state === "failed" || state === "degraded" || state === "blocked") return "bad";
  return "neutral";
}

function pillTone(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "border-[rgb(var(--accent)/0.42)] bg-[rgb(var(--accent)/0.12)] text-[rgb(var(--accent))]";
    case "busy":
      return "border-sky-500/35 bg-sky-500/10 text-sky-500 dark:text-sky-300";
    case "warn":
      return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "bad":
      return "border-[rgb(var(--danger)/0.42)] bg-[rgb(var(--danger)/0.12)] text-[rgb(var(--danger))]";
    default:
      return "border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))]";
  }
}

function dotTone(tone: Tone): string {
  switch (tone) {
    case "ok":
      return "text-[rgb(var(--accent))]";
    case "busy":
      return "text-sky-500 dark:text-sky-300";
    case "warn":
      return "text-amber-600 dark:text-amber-300";
    case "bad":
      return "text-[rgb(var(--danger))]";
    default:
      return "text-[rgb(var(--muted-foreground))]";
  }
}

function metricTone(tone: "neutral" | "ok" | "bad"): string {
  if (tone === "ok") return "text-[rgb(var(--accent))]";
  if (tone === "bad") return "text-[rgb(var(--danger))]";
  return "text-[rgb(var(--foreground))]";
}

function logLevelTone(level: string): string {
  if (level === "error") return "text-[rgb(var(--danger))]";
  if (level === "warn") return "text-amber-700 dark:text-amber-300";
  if (level === "debug") return "text-[rgb(var(--muted-foreground))]";
  return "text-[rgb(var(--accent))]";
}
