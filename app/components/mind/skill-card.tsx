import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormTextarea, fieldClass, slugify } from "@/components/lib/form-bits";
import { cn } from "@/lib/utils";
import type { SkillDto } from "@/server/dto";
import { Sigil } from "./sigil";

export interface SkillForm {
  id: string;
  name: string;
  description: string;
  body: string;
  allowedTools: string;
  tags: string;
}

export const emptySkillForm: SkillForm = {
  id: "",
  name: "",
  description: "",
  body: "",
  allowedTools: "",
  tags: "",
};

function toolCount(allowedTools: string | null | undefined): number {
  if (!allowedTools) return 0;
  return allowedTools.split(/\s+/).filter(Boolean).length;
}

function tagsArray(tags: string | null | undefined): string[] {
  if (!tags) return [];
  return tags.split(/\s+/).filter(Boolean);
}

export function SkillCard({ entry, onOpen }: { entry: SkillDto; onOpen: () => void }) {
  const tools = toolCount(entry.allowedTools);
  const tags = tagsArray(entry.tags);
  return (
    <motion.li layout transition={{ type: "spring", stiffness: 360, damping: 32 }}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group relative flex h-full w-full flex-col gap-3 overflow-hidden rounded-3xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-5 text-left transition",
          "hover:-translate-y-0.5 hover:border-[rgb(var(--foreground))]/30 motion-reduce:hover:translate-y-0",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <Sigil
            id={entry.id}
            className="opacity-60 transition group-hover:opacity-100"
            size="sm"
          />
          {tools > 0 ? (
            <span className="rounded-full border border-[rgb(var(--border))] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
              {tools} {tools === 1 ? "tool" : "tools"}
            </span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-2xl font-normal leading-tight">{entry.name}</h3>
          {entry.description ? (
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[13px] leading-snug text-[rgb(var(--muted-foreground))]">
              {entry.description}
            </p>
          ) : null}
        </div>
        {tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[rgb(var(--muted))] px-2 py-0.5 font-mono text-[10px] tracking-wide text-[rgb(var(--muted-foreground))]"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </button>
    </motion.li>
  );
}

export function NewSkillCard({ onClick }: { onClick: () => void }) {
  return (
    <motion.li layout>
      <button
        type="button"
        onClick={onClick}
        className="group flex min-h-[200px] w-full flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-[rgb(var(--border))] bg-transparent text-[rgb(var(--muted-foreground))] transition hover:border-[rgb(var(--foreground))]/40 hover:text-[rgb(var(--foreground))]"
      >
        <pre
          aria-hidden
          className="select-none whitespace-pre font-mono text-[11px] leading-[1.05] tracking-[0.2em] text-[rgb(var(--ascii))] opacity-70"
        >
{`+ · ·
· ◇ ·
· · +`}
        </pre>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em]">teach me a skill</span>
      </button>
    </motion.li>
  );
}

export interface SkillEditorCardProps {
  form: SkillForm;
  onChange: (next: SkillForm) => void;
  error: string | null;
  onSave: () => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  editing: boolean;
}

export function SkillEditorCard(props: SkillEditorCardProps) {
  const reduce = useReducedMotion();
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  return (
    <motion.li
      layout
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ gridColumn: "1 / -1" }}
      transition={{ type: "spring", stiffness: 360, damping: 30 }}
      className="rounded-3xl border border-[rgb(var(--foreground))]/30 bg-[rgb(var(--panel))] p-5 shadow-sm"
    >
      <SkillEditorBody {...props} nameRef={nameRef} />
    </motion.li>
  );
}

function SkillEditorBody({
  form,
  onChange,
  error,
  onSave,
  onCancel,
  onDelete,
  editing,
  nameRef,
}: SkillEditorCardProps & { nameRef: RefObject<HTMLInputElement | null> }) {
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
      <div className="flex items-start gap-4">
        <Sigil id={form.id || form.name || "preview"} size="md" className="mt-1" />
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              ref={nameRef}
              className={fieldClass}
              value={form.name}
              onChange={(e) => onChange({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Id (slug)">
            <input
              className={fieldClass}
              value={form.id}
              placeholder={form.name ? slugify(form.name) : "my-skill"}
              disabled={editing}
              onChange={(e) => onChange({ ...form, id: e.target.value })}
            />
          </Field>
          <Field label="Tags">
            <input
              className={fieldClass}
              placeholder="space separated"
              value={form.tags}
              onChange={(e) => onChange({ ...form, tags: e.target.value })}
            />
          </Field>
          <Field label="Allowed tools">
            <input
              className={fieldClass}
              placeholder="Bash(docling:*) Read"
              value={form.allowedTools}
              onChange={(e) => onChange({ ...form, allowedTools: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <Field label="Description">
        <FormTextarea
          rows={2}
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
        />
      </Field>
      <Field label="Body (markdown)">
        <FormTextarea
          rows={8}
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
