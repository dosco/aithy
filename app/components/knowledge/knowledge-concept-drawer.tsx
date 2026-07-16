import { ExternalLink, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/markdown";
import { fieldClass } from "@/components/lib/form-bits";
import { cn } from "@/lib/utils";
import type { KnowledgeRead } from "../../../src/knowledge/types";

export interface KnowledgeForm {
  path: string; conceptId: string; type: string; title: string; description: string; resource: string; tags: string; body: string;
}

export const emptyKnowledgeForm: KnowledgeForm = { path: "", conceptId: "", type: "", title: "", description: "", resource: "", tags: "", body: "" };

export function KnowledgeConceptDrawer(props: {
  mode: "view" | "edit" | "new" | null;
  document: KnowledgeRead | null;
  form: KnowledgeForm;
  error: string | null;
  onForm(value: KnowledgeForm): void;
  onClose(): void;
  onEdit(): void;
  onSave(): void;
  onDelete(): void;
}) {
  if (!props.mode) return null;
  const editing = props.mode === "edit" || props.mode === "new";
  return <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <aside className="absolute bottom-0 right-0 top-0 w-full max-w-3xl overflow-y-auto border-l border-[rgb(var(--border))] bg-[rgb(var(--background))] shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[rgb(var(--border))] bg-[rgb(var(--background)/0.9)] p-4 backdrop-blur">
        <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">{props.mode === "new" ? "New concept" : props.document?.path}</p><h2 className="mt-1 text-lg font-semibold">{props.mode === "new" ? "Author knowledge" : props.document?.title}</h2></div>
        <div className="flex gap-2">{props.mode === "view" && props.document?.kind === "concept" ? <Button size="sm" variant="soft" onClick={props.onEdit}><Pencil className="h-4 w-4" /> Edit</Button> : null}<Button size="icon" variant="ghost" onClick={props.onClose}><X className="h-4 w-4" /></Button></div>
      </div>
      {editing ? <KnowledgeEditor {...props} /> : props.document ? <KnowledgeViewer document={props.document} onDelete={props.onDelete} /> : null}
    </aside>
  </div>;
}

function KnowledgeEditor(props: Parameters<typeof KnowledgeConceptDrawer>[0]) {
  const set = (key: keyof KnowledgeForm, value: string) => props.onForm({ ...props.form, [key]: value });
  return <div className="space-y-4 p-5 sm:p-7">
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Path"><input className={fieldClass} value={props.form.path} placeholder="runbooks/deploy.md" onChange={(e) => set("path", e.target.value)} /></Field><Field label="Concept ID"><input className={fieldClass} value={props.form.conceptId} placeholder="Derived from path" onChange={(e) => set("conceptId", e.target.value)} /></Field></div>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Type"><input className={fieldClass} value={props.form.type} placeholder="Runbook" onChange={(e) => set("type", e.target.value)} /></Field><Field label="Title"><input className={fieldClass} value={props.form.title} onChange={(e) => set("title", e.target.value)} /></Field></div>
    <Field label="Description"><textarea className={cn(fieldClass, "min-h-20")} value={props.form.description} onChange={(e) => set("description", e.target.value)} /></Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Resource"><input className={fieldClass} value={props.form.resource} placeholder="https://..." onChange={(e) => set("resource", e.target.value)} /></Field><Field label="Tags"><input className={fieldClass} value={props.form.tags} placeholder="ops, production" onChange={(e) => set("tags", e.target.value)} /></Field></div>
    <Field label="Markdown body"><textarea className={cn(fieldClass, "min-h-[24rem] font-mono text-sm")} value={props.form.body} onChange={(e) => set("body", e.target.value)} /></Field>
    {props.error ? <p className="text-sm text-red-500">{props.error}</p> : null}
    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={props.onClose}>Cancel</Button><Button onClick={props.onSave}>Save concept</Button></div>
  </div>;
}

function KnowledgeViewer({ document, onDelete }: { document: KnowledgeRead; onDelete(): void }) {
  return <div className="p-5 sm:p-7">
    <div className="flex flex-wrap gap-2">{document.type ? <Badge>{document.type}</Badge> : null}{document.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}</div>
    {document.description ? <p className="mt-4 text-lg text-[rgb(var(--muted-foreground))]">{document.description}</p> : null}
    {document.resource ? <a className="mt-3 inline-flex items-center gap-1 text-sm underline" href={document.resource} target="_blank" rel="noreferrer noopener">Canonical resource <ExternalLink className="h-3 w-3" /></a> : null}
    {document.outline.length ? <nav className="mt-6 rounded-xl bg-[rgb(var(--muted))] p-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide">Outline</p>{document.outline.map((item, index) => <p key={`${item.anchor}-${index}`} className="text-sm" style={{ paddingLeft: `${Math.max(0, item.depth - 1) * 10}px` }}>{item.title}</p>)}</nav> : null}
    <article className="prose mt-7 max-w-none"><Markdown text={document.body} /></article>
    {document.truncated ? <p className="mt-4 text-xs text-amber-500">Body truncated at 32 KiB.</p> : null}
    <LinkGroup title="Citations" links={document.citations.map((link) => ({ label: link.label, target: link.rawTarget }))} />
    <LinkGroup title="Outbound links" links={document.links.map((link) => ({ label: `${link.label} · ${link.kind}`, target: link.rawTarget }))} />
    <LinkGroup title="Backlinks" links={document.backlinks.map((link) => ({ label: link.sourceTitle, target: link.sourcePath }))} />
    {document.kind === "concept" ? <div className="mt-10 border-t border-[rgb(var(--border))] pt-5"><Button variant="danger" onClick={onDelete}><Trash2 className="h-4 w-4" /> Delete concept</Button></div> : null}
  </div>;
}

function LinkGroup({ title, links }: { title: string; links: Array<{ label: string; target: string }> }) {
  if (!links.length) return null;
  return <section className="mt-7"><h3 className="text-sm font-semibold">{title}</h3><ul className="mt-2 space-y-1 text-sm text-[rgb(var(--muted-foreground))]">{links.map((link, index) => <li key={`${link.target}-${index}`}>{link.label} <span className="font-mono text-[10px]">{link.target}</span></li>)}</ul></section>;
}
function Badge({ children }: { children: string }) { return <span className="rounded-full bg-[rgb(var(--muted))] px-2.5 py-1 text-xs">{children}</span>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm"><span className="text-[rgb(var(--muted-foreground))]">{label}</span>{children}</label>; }
