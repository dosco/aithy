import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Copy, FileText, PauseCircle, PlayCircle, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormTextarea, fieldClass, slugify } from "@/components/lib/form-bits";
import type { SkillForm } from "./skill-card";
import type { SkillUsageDto } from "@/server/dto";

export type SkillDrawerMode = "new" | "edit" | "import";

export interface SkillDrawerProps {
  mode: SkillDrawerMode | null;
  form: SkillForm;
  pasteText: string;
  error: string | null;
  links?: string[];
  recentUsage?: SkillUsageDto[];
  onChange: (next: SkillForm) => void;
  onPasteTextChange: (value: string) => void;
  onParse: () => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void | Promise<void>;
  onDisable?: () => void | Promise<void>;
  onEnable?: () => void | Promise<void>;
}

export function SkillDrawer({
  mode,
  form,
  pasteText,
  error,
  links = [],
  recentUsage = [],
  onChange,
  onPasteTextChange,
  onParse,
  onSave,
  onClose,
  onDelete,
  onDuplicate,
  onDisable,
  onEnable,
}: SkillDrawerProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const editing = mode === "edit";
  const builtIn = form.sourceKind === "builtin";

  useEffect(() => {
    if (!mode) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  useEffect(() => {
    if (mode === "import") pasteRef.current?.focus();
    if (mode === "new" || mode === "edit") nameRef.current?.focus();
  }, [mode]);

  if (!mode) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25" role="dialog" aria-modal="true" aria-labelledby="skills-drawer-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close skills drawer" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-[40rem] flex-col border-l border-[rgb(var(--border))] bg-[rgb(var(--panel))] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[rgb(var(--border))] px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
              Skills
            </div>
            <h2 id="skills-drawer-title" className="mt-1 truncate text-xl font-medium">
              {builtIn && mode === "edit" ? "Built-in skill" : drawerTitle(mode)}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Close skills drawer" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        {mode === "import" ? (
          <ImportBody
            pasteRef={pasteRef}
            pasteText={pasteText}
            onPasteTextChange={onPasteTextChange}
            onParse={onParse}
            onClose={onClose}
          />
        ) : (
          <EditorBody
            form={form}
            nameRef={nameRef}
            error={error}
            links={links}
            recentUsage={recentUsage}
            editing={editing}
            readOnly={builtIn}
            onChange={onChange}
            onSave={onSave}
            onClose={onClose}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onDisable={onDisable}
            onEnable={onEnable}
          />
        )}
      </aside>
    </div>
  );
}

function drawerTitle(mode: SkillDrawerMode): string {
  if (mode === "edit") return "Edit skill";
  if (mode === "import") return "Import markdown";
  return "New skill";
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function FileEditor({
  form,
  onChange,
  readOnly,
}: {
  form: SkillForm;
  onChange: (next: SkillForm) => void;
  readOnly: boolean;
}) {
  function updateFile(index: number, patch: Partial<{ path: string; content: string }>) {
    const files = form.files.map((file, fileIndex) => fileIndex === index ? { ...file, ...patch } : file);
    onChange({ ...form, files });
  }

  function addFile() {
    onChange({ ...form, files: [...form.files, { path: "notes.md", content: "" }] });
  }

  function removeFile(index: number) {
    onChange({ ...form, files: form.files.filter((_file, fileIndex) => fileIndex !== index) });
  }

  return (
    <section className="mt-5 grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
          Supporting files
        </h3>
        {!readOnly ? <Button type="button" variant="soft" onClick={addFile}>
          <Plus className="h-4 w-4" /> Add file
        </Button> : null}
      </div>
      {form.files.length === 0 ? (
        <p className="text-sm text-[rgb(var(--muted-foreground))]">No supporting files.</p>
      ) : null}
      {form.files.map((file, index) => (
        <div key={index} className="grid gap-2 rounded-lg border border-[rgb(var(--border))] p-3">
          <div className="flex gap-2">
            <input
              className={fieldClass}
              value={file.path}
              placeholder="reference.md"
              readOnly={readOnly}
              onChange={(event) => updateFile(index, { path: event.target.value })}
            />
            {!readOnly ? <Button type="button" variant="soft" size="icon" aria-label="Remove file" onClick={() => removeFile(index)}>
              <Trash2 className="h-4 w-4" />
            </Button> : null}
          </div>
          <FormTextarea
            rows={6}
            value={file.content}
            readOnly={readOnly}
            onChange={(event) => updateFile(index, { content: event.target.value })}
            className="resize-y"
          />
        </div>
      ))}
    </section>
  );
}

function ImportBody({
  pasteRef,
  pasteText,
  onPasteTextChange,
  onParse,
  onClose,
}: {
  pasteRef: RefObject<HTMLTextAreaElement | null>;
  pasteText: string;
  onPasteTextChange: (value: string) => void;
  onParse: () => void;
  onClose: () => void;
}) {
  function onKeyDown(event: ReactKeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && pasteText.trim()) {
      event.preventDefault();
      onParse();
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" onKeyDown={onKeyDown}>
        <div className="mb-3 flex items-center gap-2 text-sm text-[rgb(var(--muted-foreground))]">
          <FileText className="h-4 w-4" />
          Paste frontmatter and markdown body.
        </div>
        <FormTextarea
          ref={pasteRef}
          rows={18}
          value={pasteText}
          placeholder={"---\nname: my skill\ndescription: What this skill helps with\nallowed-tools: Bash(docling:*) Read\ntags: documents conversion\n---\n\n# Steps"}
          onChange={(event) => onPasteTextChange(event.target.value)}
          className="min-h-[28rem] resize-none"
        />
      </div>
      <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-5 py-4">
        <Button type="button" variant="soft" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={onParse} disabled={!pasteText.trim()}>
          Parse
        </Button>
      </footer>
    </>
  );
}

function EditorBody({
  form,
  nameRef,
  error,
  links,
  recentUsage,
  editing,
  readOnly,
  onChange,
  onSave,
  onClose,
  onDelete,
  onDuplicate,
  onDisable,
  onEnable,
}: {
  form: SkillForm;
  nameRef: RefObject<HTMLInputElement | null>;
  error: string | null;
  links: string[];
  recentUsage: SkillUsageDto[];
  editing: boolean;
  readOnly: boolean;
  onChange: (next: SkillForm) => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void | Promise<void>;
  onDisable?: () => void | Promise<void>;
  onEnable?: () => void | Promise<void>;
}) {
  function onKeyDown(event: ReactKeyboardEvent) {
    if (!readOnly && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void onSave();
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" onKeyDown={onKeyDown}>
        <section className="grid gap-3">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
            Basics
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                ref={nameRef}
                className={fieldClass}
                value={form.name}
                readOnly={readOnly}
                onChange={(event) => onChange({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label="Id (slug)">
              <input
                className={fieldClass}
                value={form.id}
                placeholder={form.name ? slugify(form.name) : "my-skill"}
                disabled={editing || readOnly}
                onChange={(event) => onChange({ ...form, id: event.target.value })}
              />
            </Field>
            <Field label="Tags">
              <input
                className={fieldClass}
                placeholder="space separated"
                value={form.tags}
                readOnly={readOnly}
                onChange={(event) => onChange({ ...form, tags: event.target.value })}
              />
            </Field>
            <Field label="Allowed tools">
              <input
                className={fieldClass}
                placeholder="Bash(docling:*) Read"
                value={form.allowedTools}
                readOnly={readOnly}
                onChange={(event) => onChange({ ...form, allowedTools: event.target.value })}
              />
            </Field>
            <Field label="When to use">
              <input
                className={fieldClass}
                value={form.whenToUse}
                readOnly={readOnly}
                onChange={(event) => onChange({ ...form, whenToUse: event.target.value })}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-[rgb(var(--muted-foreground))]">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.userInvocable}
                disabled={readOnly}
                onChange={(event) => onChange({ ...form, userInvocable: event.target.checked })}
              />
              User invocable
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.disableModelInvocation}
                disabled={readOnly}
                onChange={(event) => onChange({ ...form, disableModelInvocation: event.target.checked })}
              />
              Disable model invocation
            </label>
          </div>
        </section>
        <section className="mt-5 grid gap-3">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
            Description
          </h3>
          <FormTextarea
            rows={3}
            value={form.description}
            readOnly={readOnly}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
          />
        </section>
        <section className="mt-5 grid gap-3">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
            SKILL.md body
          </h3>
          <FormTextarea
            rows={14}
            value={form.body}
            readOnly={readOnly}
            onChange={(event) => onChange({ ...form, body: event.target.value })}
            className="min-h-[22rem] resize-y"
          />
        </section>
        <FileEditor form={form} onChange={onChange} readOnly={readOnly} />
        {links.length > 0 || recentUsage.length > 0 ? (
          <section className="mt-5 grid gap-3">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
              Activity
            </h3>
            {links.length > 0 ? (
              <p className="text-sm text-[rgb(var(--muted-foreground))]">
                Related skills: {links.join(", ")}
              </p>
            ) : null}
            {recentUsage.map((event) => (
              <p key={`${event.createdAt}-${event.reason}`} className="text-sm text-[rgb(var(--muted-foreground))]">
                {event.reason || "Used"} {event.stage ? `(${event.stage})` : ""} · {formatDate(event.createdAt)}
              </p>
            ))}
          </section>
        ) : null}
        <FormError message={error} />
      </div>
      <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-5 py-4">
        {readOnly ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="soft" onClick={() => void onDuplicate?.()}>
                <Copy className="h-4 w-4" /> Duplicate
              </Button>
              {form.disabledAt ? (
                <Button type="button" variant="soft" onClick={() => void onEnable?.()}>
                  <PlayCircle className="h-4 w-4" /> Enable
                </Button>
              ) : (
                <Button type="button" variant="soft" onClick={() => void onDisable?.()}>
                  <PauseCircle className="h-4 w-4" /> Disable
                </Button>
              )}
            </div>
            <Button type="button" variant="soft" onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
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
          </>
        )}
      </footer>
    </>
  );
}
