import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { ThemeSync } from "@/components/theme-sync";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/lib/form-bits";
import { AutomationDeck } from "@/components/mind/automation-deck";
import { AutomationDrawer, type AutomationDrawerMode } from "@/components/mind/automation-drawer";
import {
  emptyAutomationForm,
  type AutomationForm,
} from "@/components/mind/automation-card";
import { cn } from "@/lib/utils";
import {
  archiveAutomation,
  createAutomation,
  pauseAutomation,
  resumeAutomation,
  runAutomationNow,
  updateAutomation,
} from "@/server/actions.functions";
import { getAutomationsPageState } from "@/server/state.functions";
import type { AutomationDto } from "@/server/dto";

type StatusFilter = "all" | "active" | "needs_input" | "paused";

export const Route = createFileRoute("/attentions")({
  loader: () => getAutomationsPageState(),
  component: AttentionsRoute,
});

function AttentionsRoute() {
  const initial = Route.useLoaderData();
  const [automations, setAutomations] = useState(initial.automations);
  const [drawerMode, setDrawerMode] = useState<AutomationDrawerMode | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<AutomationForm>(() => withLocalDefaults(emptyAutomationForm));
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [queuedIds, setQueuedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const visibleAutomations = useMemo(
    () => automations.filter((automation) => matchesAutomation(automation, query, status)),
    [automations, query, status],
  );
  const counts = useMemo(() => automationCounts(automations), [automations]);
  const subtitle = `${plural(automations.length, "attention")} · ${counts.active} active · ${counts.needsYou} needs you`;
  const showing = query || status !== "all"
    ? `Showing ${visibleAutomations.length.toLocaleString()} of ${automations.length.toLocaleString()}`
    : `${automations.length.toLocaleString()} total`;
  const openAutomation = openId ? automations.find((automation) => automation.id === openId) ?? null : null;

  function startNew() {
    setDrawerMode("new");
    setOpenId(null);
    setForm(withLocalDefaults(emptyAutomationForm));
    setError(null);
  }

  function openExisting(automation: AutomationDto) {
    setDrawerMode("edit");
    setOpenId(automation.id);
    setForm(automationToForm(automation));
    setError(null);
  }

  function closeDrawer() {
    setDrawerMode(null);
    setOpenId(null);
    setForm(withLocalDefaults(emptyAutomationForm));
    setError(null);
  }

  async function save() {
    setError(null);
    setPageError(null);
    const validationError = validateForm(form);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      if (drawerMode === "edit" && openId) {
        const result = await updateAutomation({ data: updatePayload(openId, form) });
        if (result.automation) replaceAutomation(result.automation);
      } else {
        const result = await createAutomation({ data: createPayload(form) });
        setAutomations((items) => [result.automation, ...items.filter((item) => item.id !== result.automation.id)]);
      }
      closeDrawer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save attention");
    }
  }

  async function runNow(automation: AutomationDto) {
    setPageError(null);
    markQueued(automation.id, true);
    try {
      await runAutomationNow({ data: { id: automation.id } });
      window.setTimeout(() => markQueued(automation.id, false), 2500);
    } catch (err) {
      markQueued(automation.id, false);
      setPageError(err instanceof Error ? err.message : "Failed to look now");
    }
  }

  async function pause(automation: AutomationDto) {
    const result = await pauseAutomation({ data: { id: automation.id } });
    if (result.automation) replaceAutomation(result.automation);
  }

  async function resume(automation: AutomationDto) {
    const result = await resumeAutomation({ data: { id: automation.id } });
    if (result.automation) replaceAutomation(result.automation);
  }

  async function archive(automation: AutomationDto) {
    const result = await archiveAutomation({ data: { id: automation.id } });
    if (!result.automation) return;
    setAutomations((items) => items.filter((item) => item.id !== automation.id));
    if (openId === automation.id) closeDrawer();
  }

  function replaceAutomation(next: AutomationDto) {
    setAutomations((items) => items.map((item) => item.id === next.id ? next : item));
  }

  function markQueued(id: string, queued: boolean) {
    setQueuedIds((current) => {
      const next = new Set(current);
      if (queued) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <PageFrame eyebrow="Mind" title="Attentions" subtitle={subtitle}>
      <ThemeSync ui={initial.settings.ui} />

      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(18rem,1fr)_auto_auto] md:items-center">
        <label className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted-foreground))]" />
          <input
            className={cn(fieldClass, "rounded-lg pl-9")}
            placeholder="Search attentions"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button type="button" onClick={startNew} className="w-full rounded-lg md:w-auto">
          <Plus className="h-4 w-4" /> New attention
        </Button>
        <AutomationStatusFilter value={status} onChange={setStatus} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[rgb(var(--muted-foreground))]">
        <span>{showing}</span>
        {pageError ? <span className="text-red-500">{pageError}</span> : null}
      </div>

      <AutomationDeck
        automations={visibleAutomations}
        queuedIds={queuedIds}
        onOpen={openExisting}
        onStartNew={startNew}
        onRunNow={(automation) => void runNow(automation)}
        onPause={(automation) => void pause(automation)}
        onResume={(automation) => void resume(automation)}
        onArchive={(automation) => void archive(automation)}
        emptyAll={automations.length === 0}
        emptyFiltered={automations.length > 0 && visibleAutomations.length === 0}
        filter={query.trim()}
      />

      <AutomationDrawer
        mode={drawerMode}
        form={form}
        automation={openAutomation}
        sessions={initial.sessions}
        error={error}
        onChange={setForm}
        onSave={save}
        onClose={closeDrawer}
        onArchive={drawerMode === "edit" && openAutomation ? () => void archive(openAutomation) : undefined}
      />
    </PageFrame>
  );
}

function AutomationStatusFilter({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
}) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3 font-mono text-xs text-[rgb(var(--muted-foreground))]">
      <SlidersHorizontal className="h-4 w-4" />
      <select
        className="bg-transparent text-[rgb(var(--foreground))] outline-none"
        value={value}
        onChange={(event) => onChange(event.target.value as StatusFilter)}
      >
        <option value="all">all statuses</option>
        <option value="active">active</option>
        <option value="needs_input">needs you</option>
        <option value="paused">resting</option>
      </select>
    </label>
  );
}

function createPayload(form: AutomationForm) {
  const scheduleKind = scheduleKindForForm(form);
  return {
    attentionType: form.attentionType,
    title: form.title.trim(),
    prompt: promptForForm(form),
    scheduleKind,
    time: form.time || undefined,
    dayOfWeek: form.dayOfWeek || undefined,
    everyMinutes: form.everyMinutes,
    cronPattern: form.cronPattern || undefined,
    runAt: scheduleKind === "once" ? form.reminderAt : undefined,
    timezone: form.timezone.trim() || undefined,
    notificationPolicy: form.notificationPolicy,
    originSessionId: form.originSessionId || undefined,
  };
}

function updatePayload(id: string, form: AutomationForm) {
  const scheduleKind = scheduleKindForForm(form);
  return {
    id,
    attentionType: form.attentionType,
    title: form.title.trim(),
    prompt: promptForForm(form),
    notificationPolicy: form.notificationPolicy,
    timezone: form.timezone.trim() || undefined,
    ...(form.changeSchedule ? {
      scheduleKind,
      time: form.time || undefined,
      dayOfWeek: form.dayOfWeek || undefined,
      everyMinutes: form.everyMinutes,
      cronPattern: form.cronPattern || undefined,
      runAt: scheduleKind === "once" ? form.reminderAt : undefined,
    } : {}),
  };
}

function automationToForm(automation: AutomationDto): AutomationForm {
  return {
    ...withLocalDefaults(emptyAutomationForm),
    attentionType: automation.attentionType,
    title: automation.title,
    prompt: automation.prompt,
    reminderAt: automation.scheduleRunAt ? isoToLocalDateTime(automation.scheduleRunAt) : defaultReminderAt(),
    scheduleKind: automation.scheduleKind === "once" ? "once" : emptyAutomationForm.scheduleKind,
    timezone: automation.timezone,
    notificationPolicy: automation.notificationPolicy,
    originSessionId: automation.originSessionId,
    changeSchedule: false,
  };
}

function withLocalDefaults(form: AutomationForm): AutomationForm {
  return {
    ...form,
    reminderAt: form.reminderAt || defaultReminderAt(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}

function matchesAutomation(automation: AutomationDto, query: string, status: StatusFilter): boolean {
  if (status !== "all" && automation.status !== status) return false;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    automation.title,
    automation.prompt,
    automation.schedule,
    automation.timezone,
    automation.notificationPolicy,
    automation.attentionType,
    attentionTypeLabel(automation.attentionType),
  ].some((value) => value.toLowerCase().includes(needle));
}

function automationCounts(automations: AutomationDto[]) {
  return {
    active: automations.filter((automation) => automation.status === "active").length,
    needsYou: automations.filter((automation) => automation.status === "needs_input").length,
  };
}

function plural(value: number, noun: string): string {
  return `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`;
}

function validateForm(form: AutomationForm): string | null {
  if (!form.title.trim() || !form.prompt.trim()) return `${form.attentionType === "briefing" ? "Topic" : "Title"} and ${promptName(form.attentionType)} are required`;
  if (form.attentionType === "reminder" && !form.reminderAt) return "Date and time are required";
  return null;
}

function promptName(type: AutomationDto["attentionType"]): string {
  if (type === "vigil") return "what to watch";
  if (type === "reminder") return "reminder text";
  if (type === "briefing") return "research brief";
  return "instruction";
}

function scheduleKindForForm(form: AutomationForm): string {
  return form.attentionType === "reminder" ? "once" : form.scheduleKind;
}

function promptForForm(form: AutomationForm): string {
  const primary = form.prompt.trim();
  const details = form.details.trim();
  if (!details) return primary;
  if (form.attentionType === "vigil") return `${primary}\n\nWhat matters:\n${details}`;
  if (form.attentionType === "briefing") return `${primary}\n\nOutput style:\n${details}`;
  return primary;
}

function defaultReminderAt(): string {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
  return localDateTime(date);
}

function isoToLocalDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? defaultReminderAt() : localDateTime(date);
}

function localDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function attentionTypeLabel(type: AutomationDto["attentionType"]): string {
  if (type === "vigil") return "Vigil";
  if (type === "reminder") return "Reminder";
  if (type === "briefing") return "Briefing";
  return "Ritual";
}
