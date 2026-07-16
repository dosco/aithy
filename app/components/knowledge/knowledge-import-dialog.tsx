import { AlertTriangle, Check, FileWarning, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OkfImportPreview } from "../../../src/knowledge/types";

export function KnowledgeImportDialog({ preview, busy, onClose, onSave }: {
  preview: OkfImportPreview | null; busy: boolean; onClose(): void; onSave(): void;
}) {
  if (!preview) return null;
  const valid = preview.invalid.length === 0;
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
    <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] p-6 shadow-2xl">
      <div className="flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">Reviewed import</p><h2 className="mt-2 text-xl font-semibold">{preview.name}</h2><p className="mt-1 text-sm text-[rgb(var(--muted-foreground))]">OKF {preview.okfVersion} · {preview.files.length} Markdown files</p></div><Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button></div>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-5"><Count label="Added" value={preview.added.length} /><Count label="Changed" value={preview.changed.length} /><Count label="Removed" value={preview.removed.length} warn /><Count label="Invalid" value={preview.invalid.length} danger /><Count label="Broken links" value={preview.brokenLinks.length} warn /></div>
      {preview.warnings.map((warning) => <Notice key={warning} icon={<AlertTriangle className="h-4 w-4" />} text={warning} />)}
      {preview.invalid.map((item) => <Notice key={item.path} icon={<FileWarning className="h-4 w-4" />} text={`${item.path}: ${item.error}`} danger />)}
      {preview.brokenLinks.slice(0, 20).map((item) => <Notice key={`${item.path}-${item.target}`} icon={<AlertTriangle className="h-4 w-4" />} text={`${item.path} → ${item.target}`} />)}
      {preview.removed.length ? <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"><strong>Snapshot replacement:</strong> accepting will delete {preview.removed.length} document{preview.removed.length === 1 ? "" : "s"} missing from this upload.</div> : null}
      <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!valid || busy} onClick={onSave}><Check className="h-4 w-4" /> {busy ? "Importing…" : "Confirm import"}</Button></div>
    </section>
  </div>;
}

function Count({ label, value, warn, danger }: { label: string; value: number; warn?: boolean; danger?: boolean }) {
  const color = danger && value ? "text-red-500" : warn && value ? "text-amber-500" : "";
  return <div className="rounded-xl bg-[rgb(var(--muted))] p-3 text-center"><p className={`text-xl font-semibold ${color}`}>{value}</p><p className="text-[10px] uppercase tracking-wide text-[rgb(var(--muted-foreground))]">{label}</p></div>;
}
function Notice({ icon, text, danger }: { icon: React.ReactNode; text: string; danger?: boolean }) { return <div className={`mt-3 flex gap-2 rounded-lg p-3 text-sm ${danger ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-600"}`}>{icon}<span>{text}</span></div>; }
