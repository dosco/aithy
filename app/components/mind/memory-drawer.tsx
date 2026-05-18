import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormTextarea, fieldClass } from "@/components/lib/form-bits";
import { cn } from "@/lib/utils";
import type { MemoryDto } from "@/server/dto";
import { MEMORY_KINDS, MEMORY_LABELS, type MemoryKind, type MemoryLabel } from "../../../src/memory/types";
import { buildMemoryHelp } from "./memory-help";
import type { MemoryForm } from "./memory-tile";

export type MemoryDrawerMode = "new" | "edit";

export interface MemoryDrawerProps {
  mode: MemoryDrawerMode | null;
  form: MemoryForm;
  memory: MemoryDto | null;
  error: string | null;
  onChange: (next: MemoryForm) => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
  onDelete?: () => void;
}

export function MemoryDrawer({
  mode,
  form,
  memory,
  error,
  onChange,
  onSave,
  onClose,
  onDelete,
}: MemoryDrawerProps) {
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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25" role="dialog" aria-modal="true" aria-labelledby="memory-drawer-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close memory drawer" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[42rem] flex-col border-l border-[rgb(var(--border))] bg-[rgb(var(--panel))] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[rgb(var(--border))] px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
              Memory
            </div>
            <h2 id="memory-drawer-title" className="mt-1 truncate text-xl font-medium">
              {editing ? "Edit memory" : "New memory"}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close memory drawer" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <MemoryEditor
          form={form}
          memory={memory}
          titleRef={titleRef}
          error={error}
          editing={editing}
          onChange={onChange}
          onSave={onSave}
          onClose={onClose}
          onDelete={onDelete}
        />
      </aside>
    </div>
  );
}

function MemoryEditor({
  form,
  memory,
  titleRef,
  error,
  editing,
  onChange,
  onSave,
  onClose,
  onDelete,
}: {
  form: MemoryForm;
  memory: MemoryDto | null;
  titleRef: RefObject<HTMLInputElement | null>;
  error: string | null;
  editing: boolean;
  onChange: (next: MemoryForm) => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
  onDelete?: () => void;
}) {
  function onKeyDown(event: ReactKeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void onSave();
    }
  }

  const duration = durationPreview(form.validFrom, form.validUntil);
  const help = buildMemoryHelp({
    kind: form.kind,
    labels: form.labels,
    validFrom: form.validFrom || null,
    validUntil: form.validUntil || null,
    evidence: form.evidence || null,
    frequency: form.frequency || null,
    retrievedCount: memory?.retrievedCount ?? 0,
    lastRecalledAt: memory?.lastRecalledAt ?? null,
  });

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" onKeyDown={onKeyDown}>
        <section className="grid gap-3">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
            Basics
          </h3>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Field label="Title">
              <input
                ref={titleRef}
                className={fieldClass}
                value={form.title}
                onChange={(event) => onChange({ ...form, title: event.target.value })}
              />
            </Field>
            <Field label="Kind">
              <select
                className={cn(fieldClass, "pr-8")}
                value={form.kind}
                onChange={(event) => onChange({ ...form, kind: event.target.value as MemoryKind })}
              >
                {MEMORY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </Field>
            <Field label={`Importance (${form.importance.toFixed(2)})`}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={form.importance}
                onChange={(event) => onChange({ ...form, importance: Number(event.target.value) })}
                className="h-10 w-32"
              />
            </Field>
          </div>
        </section>

        <Field label="Labels" className="mt-5">
          <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-auto rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background))]/55 p-2 sm:grid-cols-3">
            {MEMORY_LABELS.map((label) => {
              const active = form.labels.includes(label);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => onChange({ ...form, labels: toggleLabel(form.labels, label) })}
                  className={cn(
                    "h-8 truncate rounded-md border px-2 text-left text-xs capitalize transition",
                    active
                      ? "border-[rgb(var(--foreground))]/35 bg-[rgb(var(--muted))] text-[rgb(var(--foreground))]"
                      : "border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--muted))]/60",
                  )}
                >
                  {label.replace("_", " ")}
                </button>
              );
            })}
          </div>
        </Field>

        <section className="mt-5 border-t border-[rgb(var(--border))] pt-4">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
            How this helps
          </h3>
          <p className="mt-2 text-sm leading-6 text-[rgb(var(--muted-foreground))]">
            {help.summary}
          </p>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {help.details.map((detail) => (
              <li
                key={detail}
                className="rounded-full bg-[rgb(var(--muted))]/70 px-2 py-0.5 text-[11px] text-[rgb(var(--muted-foreground))]"
              >
                {detail}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
          <Field label="Valid from">
            <input
              className={fieldClass}
              type="date"
              value={form.validFrom}
              onChange={(event) => onChange({ ...form, validFrom: event.target.value })}
            />
          </Field>
          <Field label="Valid until">
            <input
              className={fieldClass}
              type="date"
              value={form.validUntil}
              onChange={(event) => onChange({ ...form, validUntil: event.target.value })}
            />
            {duration ? <span className="text-[11px] text-[rgb(var(--muted-foreground))]">{duration} inclusive</span> : null}
          </Field>
          <Field label="Frequency">
            <input
              className={fieldClass}
              value={form.frequency}
              onChange={(event) => onChange({ ...form, frequency: event.target.value })}
            />
          </Field>
        </section>

        <Field label="Evidence" className="mt-5">
          <FormTextarea
            rows={2}
            value={form.evidence}
            onChange={(event) => onChange({ ...form, evidence: event.target.value })}
            className="min-h-16 resize-none"
          />
        </Field>
        <Field label="Body" className="mt-5">
          <FormTextarea
            rows={8}
            value={form.body}
            onChange={(event) => onChange({ ...form, body: event.target.value })}
            className="min-h-[16rem] resize-y"
          />
        </Field>
        <FormError message={error} />
      </div>

      <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-5 py-4">
        <div>
          {onDelete ? (
            <Button type="button" variant="soft" onClick={onDelete}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="soft" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void onSave()}>
            {editing ? "Update" : "Save"}
          </Button>
        </div>
      </footer>
    </>
  );
}

function toggleLabel(labels: MemoryLabel[], label: MemoryLabel): MemoryLabel[] {
  return labels.includes(label)
    ? labels.filter((item) => item !== label)
    : [...labels, label];
}

function durationPreview(validFrom: string, validUntil: string): string | null {
  if (!validFrom || !validUntil) return null;
  const start = Date.parse(`${validFrom}T00:00:00Z`);
  const end = Date.parse(`${validUntil}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const days = Math.floor((end - start) / 86_400_000) + 1;
  return `${days}d`;
}
