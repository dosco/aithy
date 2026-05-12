import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RuntimeConsoleDto, RuntimeLogDto } from "@/server/runtime-console.dto";
import { useRuntimeConsole } from "./use-runtime-console";

export function ConsolePage({ initialState }: { initialState: RuntimeConsoleDto }) {
  const state = useRuntimeConsole(initialState);
  const logs = collapseAdjacentLogs(state.logs);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {state.services.map((service) => (
          <div key={service.role} className="border-b border-[rgb(var(--border))] py-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
              {service.role}
            </div>
            <div className="mt-1 text-lg">{service.state}</div>
            <div className="mt-1 truncate text-xs text-[rgb(var(--muted-foreground))]">
              {detailText(service.detail) || service.lastSeenAt}
            </div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="logs">
        <TabsList>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="commands">Commands</TabsTrigger>
          <TabsTrigger value="queues">Queues</TabsTrigger>
        </TabsList>

        <TabsContent value="logs">
          <div className="overflow-hidden border-y border-[rgb(var(--border))]">
            {logs.map((log) => (
              <div key={`${log.id}-${log.createdAt}`} className="grid gap-2 border-b border-[rgb(var(--border))] py-3 last:border-b-0 md:grid-cols-[9rem_7rem_1fr_10rem]">
                <span className="font-mono text-xs text-[rgb(var(--muted-foreground))]">{log.role}</span>
                <span className="font-mono text-xs uppercase">{log.level}</span>
                <span className="min-w-0 text-sm">
                  {log.message}
                  {log.repeatCount > 1 ? (
                    <span className="ml-2 font-mono text-xs text-[rgb(var(--muted-foreground))]">
                      x{log.repeatCount}
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-[rgb(var(--muted-foreground))] md:text-right">
                  {new Date(log.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="services">
          <div className="overflow-hidden border-y border-[rgb(var(--border))]">
            {state.services.map((service) => (
              <div key={service.role} className="grid gap-2 border-b border-[rgb(var(--border))] py-3 last:border-b-0 md:grid-cols-[12rem_8rem_7rem_1fr]">
                <span className="font-mono text-xs">{service.role}</span>
                <span className="text-sm">{service.state}</span>
                <span className="text-xs text-[rgb(var(--muted-foreground))]">{service.pid ?? "no pid"}</span>
                <span className="min-w-0 truncate text-xs text-[rgb(var(--muted-foreground))]">
                  {detailText(service.detail) || service.lastSeenAt}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="commands">
          <div className="overflow-hidden border-y border-[rgb(var(--border))]">
            {state.commands.map((command) => (
              <div key={command.id} className="grid gap-2 border-b border-[rgb(var(--border))] py-3 last:border-b-0 md:grid-cols-[12rem_13rem_8rem_1fr]">
                <span className="truncate font-mono text-xs text-[rgb(var(--muted-foreground))]">{command.id}</span>
                <span className="font-mono text-xs">{command.kind}</span>
                <span className="text-sm">{command.status}</span>
                <span className="min-w-0 truncate text-xs text-[rgb(var(--muted-foreground))]">
                  {detailText(command.detail) || command.targetRole}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="queues">
          <div className="overflow-hidden border-y border-[rgb(var(--border))]">
            {state.queues.map((queue) => (
              <div key={queue.id} className="grid gap-2 border-b border-[rgb(var(--border))] py-3 last:border-b-0 md:grid-cols-[10rem_12rem_7rem_1fr]">
                <span className="font-mono text-xs">{queue.id}</span>
                <span className="font-mono text-xs text-[rgb(var(--muted-foreground))]">{queue.ownerRole}</span>
                <span className="text-sm">{queue.state}</span>
                <span className="min-w-0 truncate text-xs text-[rgb(var(--muted-foreground))]">
                  {queue.blockedReason ?? `depth ${queue.depth ?? 0}, active ${queue.activeCount ?? 0}`}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface CollapsedLog extends RuntimeLogDto {
  repeatCount: number;
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
