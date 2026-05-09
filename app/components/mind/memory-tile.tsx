import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormTextarea, fieldClass } from "@/components/lib/form-bits";
import { cn } from "@/lib/utils";
import type { MemoryDto } from "@/server/dto";
import { MEMORY_KINDS, type MemoryKind } from "../../../src/memory/types";
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
  tags: string;
  importance: number;
}

export const emptyMemoryForm: MemoryForm = {
  kind: "fact",
  title: "",
  body: "",
  tags: "",
  importance: 0.5,
};

export function rowSpanForImportance(importance: number): 1 | 2 | 3 {
  if (importance >= 0.66) return 3;
  if (importance >= 0.33) return 2;
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
  if (!entry.lastRecalledAt || entry.recallCount === 0) return false;
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
  const bodyClamp = span === 3 ? "line-clamp-4" : span === 2 ? "line-clamp-2" : "line-clamp-1";

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
          "hover:-translate-y-0.5 hover:border-[rgb(var(--foreground))]/30 motion-reduce:hover:translate-y-0",
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
          <KindGlyph kind={entry.kind} />
          <ImportanceMark value={entry.importance} />
        </div>
        <div className="relative min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-medium leading-snug">{entry.title}</h3>
          {span > 1 && entry.body ? (
            <p
              className={cn(
                "mt-1.5 whitespace-pre-wrap text-[13px] leading-snug text-[rgb(var(--muted-foreground))]",
                bodyClamp,
              )}
            >
              {entry.body}
            </p>
          ) : null}
        </div>
        <div className="relative flex items-end justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-[rgb(var(--muted-foreground))]">
          <span>{relativeTime(ts)}</span>
          {entry.recallCount > 0 ? (
            <span title={`recalled ${entry.recallCount}×`}>↻ {entry.recallCount}</span>
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

export function NewMemoryTile({ onClick }: { onClick: () => void }) {
  return (
    <motion.li layout style={{ gridRow: "span 1" }}>
      <button
        type="button"
        onClick={onClick}
        className="group flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-[rgb(var(--border))] bg-transparent text-[rgb(var(--muted-foreground))] transition hover:border-[rgb(var(--foreground))]/40 hover:text-[rgb(var(--foreground))] motion-reduce:hover:translate-y-0"
      >
        <span className="text-xl leading-none">+</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]">remember something</span>
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
      style={{ gridColumn: "1 / -1" }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
      className="rounded-2xl border border-[rgb(var(--foreground))]/30 bg-[rgb(var(--panel))] p-5 shadow-sm"
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
  return (
    <div className="grid gap-3" onKeyDown={onKeyDown}>
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
      <Field label="Tags">
        <input
          className={fieldClass}
          placeholder="space separated"
          value={form.tags}
          onChange={(e) => onChange({ ...form, tags: e.target.value })}
        />
      </Field>
      <Field label="Body">
        <FormTextarea
          rows={6}
          value={form.body}
          onChange={(e) => onChange({ ...form, body: e.target.value })}
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
