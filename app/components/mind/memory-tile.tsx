import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarDays, Quote, Repeat2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormTextarea, fieldClass } from "@/components/lib/form-bits";
import { cn } from "@/lib/utils";
import type { MemoryDto } from "@/server/dto";
import { MEMORY_KINDS, MEMORY_LABELS, type MemoryKind, type MemoryLabel } from "../../../src/memory/types";
import {
  KIND_TINT_BG,
  KIND_TINT_BORDER,
  KIND_TINT_RING,
  KindGlyph,
} from "./kind-glyph";

export interface MemoryForm {
  kind: MemoryKind;
  title: string;
  body: string;
  labels: MemoryLabel[];
  validFrom: string;
  validUntil: string;
  evidence: string;
  frequency: string;
  importance: number;
}

export const emptyMemoryForm: MemoryForm = {
  kind: "fact",
  title: "",
  body: "",
  labels: [],
  validFrom: "",
  validUntil: "",
  evidence: "",
  frequency: "",
  importance: 0.5,
};

export function rowSpanForImportance(importance: number): 1 | 2 | 3 {
  if (importance >= 0.72) return 3;
  if (importance >= 0.45) return 2;
  return 1;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function isFresh(entry: MemoryDto): boolean {
  if (!entry.lastRecalledAt || entry.retrievedCount === 0) return false;
  return Date.now() - Date.parse(entry.lastRecalledAt) < 24 * 3_600_000;
}

function isStale(entry: MemoryDto): boolean {
  const ref = entry.lastRecalledAt ?? entry.updatedAt;
  return Date.now() - Date.parse(ref) > 14 * 86_400_000;
}

export function MemoryTile({
  entry,
  onOpen,
  breathing,
}: {
  entry: MemoryDto;
  onOpen: () => void;
  breathing: boolean;
}) {
  const span = rowSpanForImportance(entry.importance);
  const fresh = isFresh(entry);
  const stale = isStale(entry);
  const ts = entry.lastRecalledAt ?? entry.updatedAt;
  const bodyClamp = span === 3 ? "line-clamp-5" : span === 2 ? "line-clamp-3" : "line-clamp-1";
  const metadata = memoryMetadata(entry);

  return (
    <motion.li
      layout
      style={{ gridRow: `span ${span}` }}
      transition={{ type: "spring", stiffness: 360, damping: 32 }}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group relative flex h-full w-full flex-col gap-2 overflow-hidden rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-4 text-left transition",
          "shadow-sm shadow-black/5 hover:-translate-y-0.5 hover:border-[rgb(var(--foreground))]/30 hover:shadow-md motion-reduce:hover:translate-y-0",
          KIND_TINT_BORDER[entry.kind],
          stale && "opacity-80",
        )}
      >
        <div
          aria-hidden
          className={cn("pointer-events-none absolute inset-0", KIND_TINT_BG[entry.kind])}
        />
        {fresh ? (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 rounded-2xl ring-1",
              KIND_TINT_RING[entry.kind],
              breathing && "mind-breath",
            )}
          />
        ) : null}
        <div className="relative flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--panel))]/70 pr-2">
            <KindGlyph kind={entry.kind} />
          </span>
          <ImportanceMark value={entry.importance} />
        </div>
        <div className="relative min-w-0 flex-1">
          <h3 className="truncate text-base font-medium leading-snug">{entry.title}</h3>
          {entry.labels.length > 0 ? (
            <p className="mt-1 truncate text-[11px] capitalize text-[rgb(var(--muted-foreground))]">
              {entry.labels.map((label) => label.replace("_", " ")).join(" · ")}
            </p>
          ) : null}
          {metadata.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {metadata.map((item) => (
                <span
                  key={item.key}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-[rgb(var(--muted))]/70 px-2 py-0.5 text-[11px] text-[rgb(var(--muted-foreground))]"
                  title={item.title}
                >
                  <item.icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{item.text}</span>
                </span>
              ))}
            </div>
          ) : null}
          {span > 1 && entry.body ? (
            <p
              className={cn(
                "mt-1.5 whitespace-pre-wrap text-[13px] leading-5 text-[rgb(var(--muted-foreground))]",
                bodyClamp,
              )}
            >
              {entry.body}
            </p>
          ) : null}
        </div>
        <div className="relative flex items-end justify-between gap-2 text-[11px] text-[rgb(var(--muted-foreground))]">
          <span>{relativeTime(ts)}</span>
          {entry.retrievedCount > 0 ? (
            <span className="rounded-full bg-[rgb(var(--muted))]/70 px-2 py-0.5" title={`retrieved ${entry.retrievedCount}x`}>
              retrieved {entry.retrievedCount}x
            </span>
          ) : null}
        </div>
      </button>
    </motion.li>
  );
}

function ImportanceMark({ value }: { value: number }) {
  const alpha = 0.25 + value * 0.75;
  return (
    <span
      aria-hidden
      title={`importance ${value.toFixed(2)}`}
      className="block h-2.5 w-2.5 shrink-0 rounded-full bg-[rgb(var(--foreground))]"
      style={{ opacity: alpha }}
    />
  );
}

function memoryMetadata(entry: MemoryDto): Array<{
  key: string;
  text: string;
  title: string;
  icon: typeof CalendarDays;
}> {
  const items: Array<{ key: string; text: string; title: string; icon: typeof CalendarDays }> = [];
  if (entry.validFrom || entry.validUntil) {
    items.push({
      key: "valid",
      text: validLabel(entry),
      title: durationTitle(entry),
      icon: CalendarDays,
    });
  }
  if (entry.frequency) {
    items.push({ key: "frequency", text: entry.frequency, title: `frequency: ${entry.frequency}`, icon: Repeat2 });
  }
  if (entry.evidence) {
    items.push({ key: "evidence", text: entry.evidence, title: `evidence: ${entry.evidence}`, icon: Quote });
  }
  return items;
}

function validLabel(entry: MemoryDto): string {
  if (entry.validFrom && entry.validUntil) return `${shortDate(entry.validFrom)}-${shortDate(entry.validUntil)}`;
  if (entry.validFrom) return `from ${shortDate(entry.validFrom)}`;
  return `until ${shortDate(entry.validUntil!)}`;
}

function durationTitle(entry: MemoryDto): string {
  const base = `valid: ${entry.validFrom ?? "unknown"} to ${entry.validUntil ?? "unknown"}`;
  return entry.durationDays !== null ? `${base} (${entry.durationDays}d)` : base;
}

function shortDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${month}/${day}`;
}

export function NewMemoryTile({ onClick }: { onClick: () => void }) {
  return (
    <motion.li layout style={{ gridRow: "span 1" }}>
      <button
        type="button"
        onClick={onClick}
        className="group flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[rgb(var(--border))] bg-[rgb(var(--panel))]/35 text-[rgb(var(--muted-foreground))] transition hover:border-[rgb(var(--foreground))]/40 hover:bg-[rgb(var(--panel))]/70 hover:text-[rgb(var(--foreground))] motion-reduce:hover:translate-y-0"
      >
        <span className="text-lg leading-none">+</span>
        <span className="text-xs font-medium">Remember something</span>
      </button>
    </motion.li>
  );
}

export interface MemoryEditorTileProps {
  form: MemoryForm;
  onChange: (next: MemoryForm) => void;
  error: string | null;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  editing: boolean;
}

export function MemoryEditorTile(props: MemoryEditorTileProps) {
  const reduce = useReducedMotion();
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  return (
    <motion.li
      layout
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ gridColumn: "1 / -1", gridRow: "span 8" }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
      className="h-full rounded-2xl border border-[rgb(var(--foreground))]/30 bg-[rgb(var(--panel))] p-5 shadow-sm"
    >
      <MemoryEditorBody {...props} titleRef={titleRef} />
    </motion.li>
  );
}

function MemoryEditorBody({
  form,
  onChange,
  error,
  onSave,
  onCancel,
  onDelete,
  editing,
  titleRef,
}: MemoryEditorTileProps & { titleRef: RefObject<HTMLInputElement | null> }) {
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void onSave();
    }
  }
  const duration = durationPreview(form.validFrom, form.validUntil);
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_auto_auto_auto_minmax(0,1fr)_auto] gap-3" onKeyDown={onKeyDown}>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <Field label="Title">
          <input
            ref={titleRef}
            className={fieldClass}
            value={form.title}
            onChange={(e) => onChange({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Kind">
          <select
            className={cn(fieldClass, "pr-8")}
            value={form.kind}
            onChange={(e) => onChange({ ...form, kind: e.target.value as MemoryKind })}
          >
            {MEMORY_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
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
            onChange={(e) => onChange({ ...form, importance: Number(e.target.value) })}
            className="h-10 w-32"
          />
        </Field>
      </div>
      <Field label="Labels">
        <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-auto rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))]/55 p-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {MEMORY_LABELS.map((label) => {
            const active = form.labels.includes(label);
            return (
              <button
                key={label}
                type="button"
                onClick={() => onChange({ ...form, labels: toggleLabel(form.labels, label) })}
                className={cn(
                  "h-8 truncate rounded-lg border px-2 text-left text-xs capitalize transition",
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
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)]">
        <Field label="Valid from">
          <input
            className={fieldClass}
            type="date"
            value={form.validFrom}
            onChange={(e) => onChange({ ...form, validFrom: e.target.value })}
          />
        </Field>
        <Field label="Valid until">
          <input
            className={fieldClass}
            type="date"
            value={form.validUntil}
            onChange={(e) => onChange({ ...form, validUntil: e.target.value })}
          />
          {duration ? (
            <span className="text-[11px] text-[rgb(var(--muted-foreground))]">
              {duration} inclusive
            </span>
          ) : null}
        </Field>
        <Field label="Frequency">
          <input
            className={fieldClass}
            value={form.frequency}
            onChange={(e) => onChange({ ...form, frequency: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Evidence">
        <FormTextarea
          rows={2}
          value={form.evidence}
          onChange={(e) => onChange({ ...form, evidence: e.target.value })}
          className="min-h-16 resize-none"
        />
      </Field>
      <Field label="Body" className="grid-rows-[auto_minmax(0,1fr)]">
        <FormTextarea
          rows={4}
          value={form.body}
          onChange={(e) => onChange({ ...form, body: e.target.value })}
          className="h-full min-h-40 resize-none"
        />
      </Field>
      <FormError message={error} />
      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
          esc to close · ⌘↵ to save
        </p>
        <div className="flex gap-2">
          {onDelete ? (
            <Button variant="soft" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          ) : null}
          <Button variant="soft" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void onSave()}>
            {editing ? "Update" : "Save"}
          </Button>
        </div>
      </div>
    </div>
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
