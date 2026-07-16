import { useMemo, useRef, useState } from "react";
import { BookOpenText, Download, FilePlus2, FolderInput, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/lib/form-bits";
import { cn } from "@/lib/utils";
import type { KnowledgeBundle, KnowledgeProposalReview, OkfFileInput, OkfImportPreview } from "../../src/knowledge/types";
import {
  createKnowledgeBundle,
  deleteKnowledgeBundle,
  listKnowledgeDocuments,
  previewKnowledgeImport,
  readKnowledgeDocument,
  resolveKnowledgeProposal,
  saveKnowledgeImport,
  setKnowledgeBundleEnabled,
  updateKnowledgeBundle,
  upsertKnowledgeConcept,
  deleteKnowledgeDocument,
} from "@/server/knowledge.functions";
import { KnowledgeConceptDrawer, emptyKnowledgeForm, type KnowledgeForm } from "./knowledge/knowledge-concept-drawer";
import { KnowledgeDocumentList, type KnowledgeDocumentSummary } from "./knowledge/knowledge-document-list";
import { KnowledgeImportDialog } from "./knowledge/knowledge-import-dialog";
import { KnowledgeProposals } from "./knowledge/knowledge-proposals";
import { ThemeSync } from "./theme-sync";
import type { UiPreferences } from "../../src/settings/types";

interface KnowledgePageState {
  bundles: KnowledgeBundle[];
  documents: KnowledgeDocumentSummary[];
  proposals: KnowledgeProposalReview[];
  settings?: { ui: UiPreferences };
}

export function KnowledgePage({ initialState }: { initialState: KnowledgePageState }) {
  const [bundles, setBundles] = useState(initialState.bundles);
  const [bundleId, setBundleId] = useState(initialState.bundles[0]?.id ?? "");
  const [documents, setDocuments] = useState(initialState.documents);
  const [proposals, setProposals] = useState(initialState.proposals);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [tag, setTag] = useState("all");
  const [sort, setSort] = useState<"recent" | "retrieved" | "path">("recent");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openDocument, setOpenDocument] = useState<Awaited<ReturnType<typeof readKnowledgeDocument>> | null>(null);
  const [drawerMode, setDrawerMode] = useState<"view" | "edit" | "new" | null>(null);
  const [form, setForm] = useState<KnowledgeForm>(emptyKnowledgeForm);
  const [error, setError] = useState<string | null>(null);
  const [importFiles, setImportFiles] = useState<OkfFileInput[] | null>(null);
  const [importPreview, setImportPreview] = useState<OkfImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const bundle = bundles.find((item) => item.id === bundleId) ?? null;
  const types = useMemo(() => [...new Set(documents.map((doc) => doc.type).filter((value): value is string => Boolean(value)))].sort(), [documents]);
  const tags = useMemo(() => [...new Set(documents.flatMap((doc) => doc.tags))].sort(), [documents]);

  async function refresh(nextBundleId = bundleId, overrides: { query?: string; type?: string; tag?: string; sort?: typeof sort } = {}) {
    if (!nextBundleId) { setDocuments([]); return; }
    const result = await listKnowledgeDocuments({ data: {
      bundleId: nextBundleId,
      query: (overrides.query ?? query) || undefined,
      type: (overrides.type ?? type) === "all" ? undefined : overrides.type ?? type,
      tag: (overrides.tag ?? tag) === "all" ? undefined : overrides.tag ?? tag,
      sort: overrides.sort ?? sort,
    } });
    setDocuments(result.documents);
  }

  async function selectBundle(id: string) {
    setBundleId(id); setQuery(""); setType("all"); setTag("all"); setSort("recent"); setFiltersOpen(false); setOpenDocument(null); setDrawerMode(null);
    await refresh(id, { query: "", type: "all", tag: "all" });
  }

  async function createBundle() {
    const name = window.prompt("Bundle name");
    if (!name?.trim()) return;
    const result = await createKnowledgeBundle({ data: { name: name.trim() } });
    setBundles(result.bundles); await selectBundle(result.bundle.id);
  }

  async function editBundle() {
    if (!bundle || bundle.source !== "manual") return;
    const name = window.prompt("Bundle name", bundle.name);
    if (!name?.trim()) return;
    const description = window.prompt("Bundle description", bundle.description);
    if (description === null) return;
    const result = await updateKnowledgeBundle({ data: { bundleId: bundle.id, name: name.trim(), description } });
    setBundles(result.bundles);
  }

  async function open(id: string) {
    const document = await readKnowledgeDocument({ data: { id } });
    if (!document) return;
    setOpenDocument(document); setForm(documentToForm(document)); setDrawerMode("view"); setError(null);
  }

  async function saveConcept() {
    if (!bundleId) return;
    setError(null);
    try {
      const document = await upsertKnowledgeConcept({ data: {
        id: drawerMode === "edit" ? openDocument?.id : undefined,
        bundleId, path: form.path, conceptId: form.conceptId || undefined, type: form.type,
        title: form.title, description: form.description, resource: form.resource,
        tags: form.tags.split(",").map((value) => value.trim()).filter(Boolean),
        frontmatter: drawerMode === "edit" ? openDocument?.frontmatter : undefined,
        body: form.body,
      } });
      await refresh(); await open(document.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save concept."); }
  }

  async function removeDocument() {
    if (!openDocument || !window.confirm(`Delete ${openDocument.title}?`)) return;
    await deleteKnowledgeDocument({ data: { id: openDocument.id } });
    setDrawerMode(null); setOpenDocument(null); await refresh();
  }

  async function chooseImport(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setError(null);
    try {
      const input = await Promise.all([...files].filter((file) => file.name.toLowerCase().endsWith(".md")).map(async (file) => ({
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        content: await file.text(),
      })));
      const preview = await previewKnowledgeImport({ data: { bundleId: bundle?.source === "okf" ? bundleId : undefined, files: input } });
      setImportFiles(input); setImportPreview(preview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to preview OKF import."); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  async function saveImport() {
    if (!importFiles || !importPreview) return;
    setBusy(true);
    try {
      const result = await saveKnowledgeImport({ data: {
        bundleId: bundle?.source === "okf" ? bundleId : undefined,
        files: importFiles, confirmRemoved: importPreview.removed.length > 0,
      } });
      setBundles(result.bundles); setBundleId(result.bundle.id); setDocuments(result.documents); setProposals(result.proposals);
      setImportFiles(null); setImportPreview(null);
    } finally { setBusy(false); }
  }

  async function resolveProposal(id: string, decision: "accept" | "reject") {
    const result = await resolveKnowledgeProposal({ data: { id, decision } });
    setProposals(result.proposals);
    if (result.proposal.bundleId === bundleId) setDocuments(result.documents);
  }

  return (
    <PageFrame eyebrow="Knowledge" title="Knowledge Library" subtitle={`${countLabel(bundles.length, "bundle")} · ${countLabel(documents.length, "document")}`}>
      {initialState.settings ? <ThemeSync ui={initialState.settings.ui} /> : null}
      <section className="mb-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <label className="block min-w-0 max-w-md flex-1"><span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">Bundle</span><select className={cn(fieldClass, "mt-1 h-10 rounded-lg bg-transparent font-medium")} value={bundleId} onChange={(event) => void selectBundle(event.target.value)}>
            {!bundles.length ? <option value="">No bundles yet</option> : null}
            {bundles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          {bundle ? <Button className="rounded-lg md:self-end" onClick={() => { setForm(emptyKnowledgeForm); setOpenDocument(null); setDrawerMode("new"); }}><FilePlus2 className="h-4 w-4" /> New concept</Button> : null}
        </div>
        {bundle ? <p className="mt-2 text-xs text-[rgb(var(--muted-foreground))]">{bundle.description || "No description"}</p> : null}
        <input ref={(node) => { fileInput.current = node; node?.setAttribute("webkitdirectory", ""); }} type="file" multiple hidden onChange={(event) => void chooseImport(event.target.files)} />
        {bundle ? <details className="mt-3 text-xs text-[rgb(var(--muted-foreground))]"><summary className="inline-flex cursor-pointer list-none items-center gap-1 hover:text-[rgb(var(--foreground))]">Bundle options</summary><div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 border-l border-[rgb(var(--border))] pl-3">
          <label className="flex items-center gap-2 text-[rgb(var(--foreground))]"><input type="checkbox" checked={bundle.enabled} onChange={async (event) => {
            const updated = await setKnowledgeBundleEnabled({ data: { bundleId: bundle.id, enabled: event.target.checked } });
            setBundles((items) => items.map((item) => item.id === updated.id ? updated : item));
          }} /> Available to agent</label>
          <button className="inline-flex items-center gap-1 hover:text-[rgb(var(--foreground))]" onClick={() => void createBundle()}><Plus className="h-3.5 w-3.5" /> New bundle</button>
          {bundle.source === "manual" ? <button className="inline-flex items-center gap-1 hover:text-[rgb(var(--foreground))]" onClick={() => void editBundle()}><Pencil className="h-3.5 w-3.5" /> Edit bundle</button> : null}
          <button className="inline-flex items-center gap-1 hover:text-[rgb(var(--foreground))]" onClick={() => fileInput.current?.click()} disabled={busy}><FolderInput className="h-3.5 w-3.5" /> Import OKF</button>
          <a className="inline-flex items-center gap-1 hover:text-[rgb(var(--foreground))]" href={`/api/knowledge/${bundle.id}`}><Download className="h-3.5 w-3.5" /> Export</a>
          <button className="inline-flex items-center gap-1 text-[rgb(var(--danger))] hover:underline" onClick={async () => {
            if (!window.confirm(`Delete bundle ${bundle.name} and all its concepts?`)) return;
            const result = await deleteKnowledgeBundle({ data: { bundleId: bundle.id } }); setBundles(result.bundles); await selectBundle(result.bundles[0]?.id ?? "");
          }}><Trash2 className="h-3.5 w-3.5" /> Delete bundle</button>
          <span>{bundle.source === "okf" ? `OKF ${bundle.okfVersion ?? "0.1"}` : "Manual bundle"}</span>
        </div></details> : <div className="mt-3 flex gap-2"><Button className="rounded-lg" onClick={() => void createBundle()}><Plus className="h-4 w-4" /> New bundle</Button><Button variant="ghost" className="rounded-lg" onClick={() => fileInput.current?.click()} disabled={busy}><FolderInput className="h-4 w-4" /> Import OKF</Button></div>}
      </section>

      {error ? <p className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{error}</p> : null}
      <KnowledgeProposals proposals={proposals} bundles={bundles} onResolve={resolveProposal} />

      {bundle ? <section><div className="mb-4 grid gap-3 md:grid-cols-[auto_minmax(16rem,1fr)_auto] md:items-center"><h2 className="font-semibold">Documents <span className="ml-1 font-mono text-xs font-normal text-[rgb(var(--muted-foreground))]">{documents.length}</span></h2><label className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[rgb(var(--muted-foreground))]" /><input className={cn(fieldClass, "h-10 rounded-lg pl-9")} value={query} placeholder="Search documents" onChange={(event) => { setQuery(event.target.value); void refresh(bundleId, { query: event.target.value }); }} /></label><Button size="sm" variant="ghost" className="rounded-lg" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}><SlidersHorizontal className="h-4 w-4" /> Filters{type !== "all" || tag !== "all" || sort !== "recent" ? " · active" : ""}</Button></div>
        {filtersOpen ? <div className="mb-4 grid gap-2 border-l border-[rgb(var(--border))] pl-3 sm:grid-cols-3">
          <select aria-label="Filter by type" className={cn(fieldClass, "h-10 rounded-lg")} value={type} onChange={(event) => { setType(event.target.value); void refresh(bundleId, { type: event.target.value }); }}><option value="all">All types</option>{types.map((item) => <option key={item}>{item}</option>)}</select>
          <select aria-label="Filter by tag" className={cn(fieldClass, "h-10 rounded-lg")} value={tag} onChange={(event) => { setTag(event.target.value); void refresh(bundleId, { tag: event.target.value }); }}><option value="all">All tags</option>{tags.map((item) => <option key={item}>{item}</option>)}</select>
          <select aria-label="Sort documents" className={cn(fieldClass, "h-10 rounded-lg")} value={sort} onChange={(event) => { const value = event.target.value as typeof sort; setSort(value); void refresh(bundleId, { sort: value }); }}><option value="recent">Recently updated</option><option value="retrieved">Most retrieved</option><option value="path">Path</option></select>
        </div> : null}
      </section> : null}

      {documents.length ? <KnowledgeDocumentList documents={documents} onOpen={(id) => void open(id)} /> : null}
      {!bundle ? <EmptyKnowledge onCreate={createBundle} /> : documents.length === 0 ? <p className="border-y border-[rgb(var(--border))] py-14 text-center text-[rgb(var(--muted-foreground))]">No documents match this view.</p> : null}

      <KnowledgeConceptDrawer mode={drawerMode} document={openDocument} form={form} error={error} onForm={setForm} onClose={() => setDrawerMode(null)} onEdit={() => setDrawerMode("edit")} onSave={() => void saveConcept()} onDelete={() => void removeDocument()} />
      <KnowledgeImportDialog preview={importPreview} busy={busy} onClose={() => { setImportPreview(null); setImportFiles(null); }} onSave={() => void saveImport()} />
    </PageFrame>
  );
}

function EmptyKnowledge({ onCreate }: { onCreate(): void }) {
  return <div className="border-y border-[rgb(var(--border))] py-14 text-center"><BookOpenText className="mx-auto h-9 w-9 text-[rgb(var(--muted-foreground))]" /><h2 className="mt-4 text-xl font-semibold">Build a trusted library</h2><p className="mx-auto mt-2 max-w-xl text-sm text-[rgb(var(--muted-foreground))]">Author concepts here or import a reviewed OKF folder. SQLite remains the source of truth.</p><Button className="mt-5 rounded-lg" onClick={onCreate}>Create a bundle</Button></div>;
}

function countLabel(count: number, noun: string) { return `${count} ${noun}${count === 1 ? "" : "s"}`; }

function documentToForm(document: NonNullable<Awaited<ReturnType<typeof readKnowledgeDocument>>>): KnowledgeForm {
  return { path: document.path, conceptId: document.conceptId ?? "", type: document.type ?? "", title: document.title,
    description: document.description, resource: document.resource ?? "", tags: document.tags.join(", "), body: document.body };
}
