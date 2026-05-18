import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Archive, BellRing, Eye, Newspaper, Repeat2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormTextarea, fieldClass } from "@/components/lib/form-bits";
import type { AutomationDto, SessionSummaryDto } from "@/server/dto";
import { cn } from "@/lib/utils";
import type { AutomationForm } from "./automation-card";

export type AutomationDrawerMode = "new" | "edit";

interface AutomationDrawerProps {
  mode: AutomationDrawerMode | null;
  form: AutomationForm;
  automation: AutomationDto | null;
  sessions: SessionSummaryDto[];
  error: string | null;
  onChange: (next: AutomationForm) => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
  onArchive?: () => void;
}

const SCHEDULE_OPTIONS = [
  ["daily", "Daily"],
  ["weekdays", "Weekdays"],
  ["weekly", "Weekly"],
  ["hourly", "Hourly"],
  ["interval_minutes", "Every N minutes"],
  ["cron", "Cron"],
] as const;

const POLICY_OPTIONS: Array<[AutomationDto["notificationPolicy"], string]> = [
  ["attention_only", "Notify only when useful"],
  ["always", "Notify every run"],
  ["failures_only", "Failures only"],
  ["silent", "Silent log"],
];

const ATTENTION_TYPES = [
  { value: "vigil", label: "Vigil", description: "Watch for changes", icon: Eye },
  { value: "reminder", label: "Reminder", description: "Nudge once", icon: BellRing },
  { value: "ritual", label: "Ritual", description: "Repeat an action", icon: Repeat2 },
  { value: "briefing", label: "Briefing", description: "Research and summarize", icon: Newspaper },
] as const;

export function AutomationDrawer({
  mode,
  form,
  automation,
  sessions,
  error,
  onChange,
  onSave,
  onClose,
  onArchive,
}: AutomationDrawerProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const editing = mode === "edit";

  useEffect(() => {
    if (!mode) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  useEffect(() => {
    if (mode) titleRef.current?.focus();
  }, [mode]);

  if (!mode) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25" role="dialog" aria-modal="true" aria-labelledby="automation-drawer-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close automation drawer" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[42rem] flex-col border-l border-[rgb(var(--border))] bg-[rgb(var(--panel))] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[rgb(var(--border))] px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
              Attentions
            </div>
            <h2 id="automation-drawer-title" className="mt-1 truncate text-xl font-medium">
              {editing ? "Edit attention" : "New attention"}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close automation drawer" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        <AutomationEditor
          form={form}
          automation={automation}
          sessions={sessions}
          titleRef={titleRef}
          error={error}
          editing={editing}
          onChange={onChange}
          onSave={onSave}
          onClose={onClose}
          onArchive={onArchive}
        />
      </aside>
    </div>
  );
}

function AutomationEditor({
  form,
  automation,
  sessions,
  titleRef,
  error,
  editing,
  onChange,
  onSave,
  onClose,
  onArchive,
}: {
  form: AutomationForm;
  automation: AutomationDto | null;
  sessions: SessionSummaryDto[];
  titleRef: RefObject<HTMLInputElement | null>;
  error: string | null;
  editing: boolean;
  onChange: (next: AutomationForm) => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
  onArchive?: () => void;
}) {
  const copy = typeCopy(form.attentionType);

  function onKeyDown(event: ReactKeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void onSave();
    }
  }

  function chooseType(attentionType: AutomationDto["attentionType"]) {
    onChange({
      ...form,
      attentionType,
      notificationPolicy: defaultPolicy(attentionType),
      scheduleKind: attentionType === "reminder" ? "once" : form.scheduleKind === "once" ? "daily" : form.scheduleKind,
      changeSchedule: attentionType === "reminder" || form.scheduleKind === "once" ? true : form.changeSchedule,
      reminderAt: form.reminderAt || defaultReminderAt(),
    });
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" onKeyDown={onKeyDown}>
        <section className="grid gap-3">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
            Type
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {ATTENTION_TYPES.map((option) => {
              const Icon = option.icon;
              const selected = form.attentionType === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "grid min-h-[4.5rem] gap-1 rounded-lg border px-3 py-2 text-left transition",
                    selected
                      ? "border-[rgb(var(--foreground))] bg-[rgb(var(--muted))]"
                      : "border-[rgb(var(--border))] bg-[rgb(var(--background))]/45 hover:border-[rgb(var(--foreground))]/35",
                  )}
                  onClick={() => chooseType(option.value)}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4" />
                    {option.label}
                  </span>
                  <span className="text-xs text-[rgb(var(--muted-foreground))]">{option.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-5 grid gap-3 border-t border-[rgb(var(--border))] pt-4">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
            {copy.section}
          </h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
            <Field label={copy.titleLabel}>
              <input
                ref={titleRef}
                className={fieldClass}
                placeholder={copy.titlePlaceholder}
                value={form.title}
                onChange={(event) => onChange({ ...form, title: event.target.value })}
              />
            </Field>
            <Field label="Notifications">
              <select
                className={cn(fieldClass, "pr-8")}
                value={form.notificationPolicy}
                onChange={(event) => onChange({ ...form, notificationPolicy: event.target.value as AutomationDto["notificationPolicy"] })}
              >
                {POLICY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={copy.promptLabel}>
            <FormTextarea
              rows={7}
              value={form.prompt}
              placeholder={copy.promptPlaceholder}
              onChange={(event) => onChange({ ...form, prompt: event.target.value })}
              className="min-h-[12rem] resize-y"
            />
          </Field>
          {copy.detailsLabel ? (
            <Field label={copy.detailsLabel}>
              <FormTextarea
                rows={4}
                value={form.details}
                placeholder={copy.detailsPlaceholder}
                onChange={(event) => onChange({ ...form, details: event.target.value })}
                className="resize-y"
              />
            </Field>
          ) : null}
        </section>

        <section className="mt-5 grid gap-3 border-t border-[rgb(var(--border))] pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
              {form.attentionType === "reminder" ? "When" : "Rhythm"}
            </h3>
            {editing && !form.changeSchedule ? (
              <Button type="button" variant="soft" size="sm" className="rounded-lg" onClick={() => onChange({ ...form, changeSchedule: true })}>
                Change rhythm
              </Button>
            ) : null}
          </div>

          {editing && !form.changeSchedule && automation ? (
            <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))]/55 px-3 py-2 text-sm">
              <div className="font-medium">{automation.schedule}</div>
              <div className="mt-1 text-xs text-[rgb(var(--muted-foreground))]">
                {automation.timezone} - next look {formatDate(automation.nextRunAt)}
              </div>
            </div>
          ) : (
            <ScheduleFields form={form} onChange={onChange} />
          )}
        </section>

        <section className="mt-5 grid gap-3 border-t border-[rgb(var(--border))] pt-4">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
            Thread
          </h3>
          {editing && automation ? (
            <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))]/55 px-3 py-2 text-sm">
              <div className="font-medium">{sessionName(sessions, automation.originSessionId)}</div>
              <div className="mt-1 font-mono text-[11px] text-[rgb(var(--muted-foreground))]">{automation.originSessionId}</div>
            </div>
          ) : (
            <Field label="Parent session">
              <select
                className={cn(fieldClass, "pr-8")}
                value={form.originSessionId}
                onChange={(event) => onChange({ ...form, originSessionId: event.target.value })}
              >
                <option value="">Standalone attention thread</option>
                {sessions.map((session) => (
                  <option key={session.conversationId} value={session.conversationId}>{session.name}</option>
                ))}
              </select>
            </Field>
          )}
        </section>

        <FormError message={error} />
      </div>

      <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-5 py-4">
        <div>
          {onArchive ? (
            <Button type="button" variant="soft" onClick={onArchive}>
              <Archive className="h-4 w-4" /> Archive
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="soft" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onSave()}>
            {editing ? "Update" : "Create"}
          </Button>
        </div>
      </footer>
    </>
  );
}

function ScheduleFields({ form, onChange }: { form: AutomationForm; onChange: (next: AutomationForm) => void }) {
  if (form.attentionType === "reminder") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date and time">
          <input
            type="datetime-local"
            className={fieldClass}
            value={form.reminderAt}
            onChange={(event) => onChange({ ...form, scheduleKind: "once", reminderAt: event.target.value })}
          />
        </Field>
        <Field label="Timezone">
          <input
            className={fieldClass}
            value={form.timezone}
            placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}
            onChange={(event) => onChange({ ...form, timezone: event.target.value })}
          />
        </Field>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cadence">
          <select
            className={cn(fieldClass, "pr-8")}
            value={form.scheduleKind}
            onChange={(event) => onChange({ ...form, scheduleKind: event.target.value })}
          >
            {SCHEDULE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Timezone">
          <input
            className={fieldClass}
            value={form.timezone}
            placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}
            onChange={(event) => onChange({ ...form, timezone: event.target.value })}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {needsTime(form.scheduleKind) ? (
          <Field label="Time">
            <input
              type="time"
              className={fieldClass}
              value={form.time}
              onChange={(event) => onChange({ ...form, time: event.target.value })}
            />
          </Field>
        ) : null}
        {form.scheduleKind === "weekly" ? (
          <Field label="Day">
            <select
              className={cn(fieldClass, "pr-8")}
              value={form.dayOfWeek}
              onChange={(event) => onChange({ ...form, dayOfWeek: event.target.value })}
            >
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => (
                <option key={day} value={String(index)}>{day}</option>
              ))}
            </select>
          </Field>
        ) : null}
        {form.scheduleKind === "interval_minutes" ? (
          <Field label="Every minutes">
            <input
              type="number"
              min={1}
              max={43200}
              className={fieldClass}
              value={form.everyMinutes}
              onChange={(event) => onChange({ ...form, everyMinutes: Number(event.target.value) || 1 })}
            />
          </Field>
        ) : null}
        {form.scheduleKind === "cron" ? (
          <Field label="Cron pattern">
            <input
              className={fieldClass}
              value={form.cronPattern}
              onChange={(event) => onChange({ ...form, cronPattern: event.target.value })}
            />
          </Field>
        ) : null}
      </div>
    </div>
  );
}

function needsTime(kind: string): boolean {
  return kind === "daily" || kind === "weekdays" || kind === "weekly";
}

function formatDate(value: string | null): string {
  if (!value) return "not scheduled";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sessionName(sessions: SessionSummaryDto[], id: string): string {
  return sessions.find((session) => session.conversationId === id)?.name ?? "Attention thread";
}

function defaultPolicy(type: AutomationDto["attentionType"]): AutomationDto["notificationPolicy"] {
  return type === "reminder" || type === "briefing" ? "always" : "attention_only";
}

function defaultReminderAt(): string {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function typeCopy(type: AutomationDto["attentionType"]) {
  if (type === "vigil") {
    return {
      section: "Vigil",
      titleLabel: "Title",
      titlePlaceholder: "Release watch",
      promptLabel: "What to watch",
      promptPlaceholder: "Watch the latest release notes for the tools I use.",
      detailsLabel: "What matters",
      detailsPlaceholder: "Only raise it when there is a breaking change, security note, or migration step.",
    };
  }
  if (type === "reminder") {
    return {
      section: "Reminder",
      titleLabel: "Title",
      titlePlaceholder: "Renew passport",
      promptLabel: "Reminder text",
      promptPlaceholder: "Remind me to renew my passport and include the documents I need.",
      detailsLabel: "",
      detailsPlaceholder: "",
    };
  }
  if (type === "briefing") {
    return {
      section: "Briefing",
      titleLabel: "Topic",
      titlePlaceholder: "AI policy scan",
      promptLabel: "Research brief",
      promptPlaceholder: "Research the most important AI policy developments since the last look.",
      detailsLabel: "Output style",
      detailsPlaceholder: "Write a short executive summary with links, dates, and recommended follow-up.",
    };
  }
  return {
    section: "Ritual",
    titleLabel: "Title",
    titlePlaceholder: "Morning market scan",
    promptLabel: "Instruction",
    promptPlaceholder: "Check the latest market news and summarize anything I should act on.",
    detailsLabel: "",
    detailsPlaceholder: "",
  };
}
