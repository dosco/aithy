import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RotateCcw, Square, ExternalLink } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { useLiveEvent } from "@/components/live-events";
import { Button } from "@/components/ui/button";
import { cancelTask, retryTask } from "@/server/actions.functions";
import { getTasksPageState } from "@/server/state.functions";
import type { TaskDto } from "@/server/dto";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tasks")({
  loader: () => getTasksPageState(),
  component: TasksRoute,
});

function TasksRoute() {
  const initialState = Route.useLoaderData();
  const [tasks, setTasks] = useState(initialState.tasks);
  const grouped = useMemo(() => ({
    active: tasks.filter((task) => isActive(task.status)),
    failed: tasks.filter((task) => task.status === "failed"),
    recent: tasks.filter((task) => !isActive(task.status) && task.status !== "failed"),
  }), [tasks]);

  useLiveEvent((event) => {
    if (event.type !== "task-status") return;
    setTasks((current) => upsertTask(current, event.task));
  });

  return (
    <PageFrame eyebrow="Work" title="Tasks">
      <div className="grid gap-6">
        <TaskSection title="Active" tasks={grouped.active} empty="No active tasks." />
        <TaskSection title="Needs Attention" tasks={grouped.failed} empty="No failed tasks." />
        <TaskSection title="Recent" tasks={grouped.recent} empty="No recent tasks." />
      </div>
    </PageFrame>
  );
}

function TaskSection({ title, tasks, empty }: { title: string; tasks: TaskDto[]; empty: string }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between border-b border-[rgb(var(--border))] pb-2">
        <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">{title}</h2>
        <span className="font-mono text-xs text-[rgb(var(--muted-foreground))]">{tasks.length}</span>
      </div>
      <div className="divide-y divide-[rgb(var(--border))]">
        {tasks.length ? tasks.map((task) => <TaskRow key={task.id} task={task} />) : (
          <div className="py-8 text-sm text-[rgb(var(--muted-foreground))]">{empty}</div>
        )}
      </div>
    </section>
  );
}

function TaskRow({ task }: { task: TaskDto }) {
  return (
    <div className="grid gap-3 py-4 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={task.status} />
          <span className="font-mono text-xs text-[rgb(var(--muted-foreground))]">{task.kind}</span>
        </div>
        <h3 className="mt-2 break-words text-base font-medium">{task.title}</h3>
        <p className="mt-1 text-sm text-[rgb(var(--muted-foreground))]">
          {task.reason ?? "No details"} · {new Date(task.updatedAt).toLocaleString()}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {task.relatedSessionId ? (
          <Button asChild variant="soft" size="sm">
            <Link to="/chat/$sessionId" params={{ sessionId: task.relatedSessionId }}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Open
            </Link>
          </Button>
        ) : null}
        {task.canRetry ? (
          <Button variant="soft" size="sm" onClick={() => void retryTask({ data: { taskId: task.id } })}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        ) : null}
        {task.canCancel ? (
          <Button variant="soft" size="sm" onClick={() => void cancelTask({ data: { taskId: task.id } })}>
            <Square className="mr-1.5 h-3.5 w-3.5" /> Stop
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: TaskDto["status"] }) {
  return (
    <span className={cn("rounded border px-2 py-0.5 font-mono text-[11px] uppercase", statusTone(status))}>
      {status.replace("_", " ")}
    </span>
  );
}

function upsertTask(tasks: TaskDto[], task: TaskDto): TaskDto[] {
  const next = [task, ...tasks.filter((item) => item.id !== task.id)];
  return next.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 100);
}

function isActive(status: TaskDto["status"]): boolean {
  return status === "planned" || status === "running" || status === "paused_approval";
}

function statusTone(status: TaskDto["status"]): string {
  if (status === "completed") return "border-[rgb(var(--accent)/0.42)] bg-[rgb(var(--accent)/0.12)] text-[rgb(var(--accent))]";
  if (status === "failed") return "border-[rgb(var(--danger)/0.42)] bg-[rgb(var(--danger)/0.12)] text-[rgb(var(--danger))]";
  if (status === "cancelled") return "border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))]";
  if (status === "paused_approval") return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-sky-500/35 bg-sky-500/10 text-sky-600 dark:text-sky-300";
}
