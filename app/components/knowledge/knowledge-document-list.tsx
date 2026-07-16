import type { KnowledgeDocument } from "../../../src/knowledge/types";

export type KnowledgeDocumentSummary = Pick<KnowledgeDocument, "id" | "bundleId" | "path" | "kind" | "conceptId" | "type" | "title" | "description" | "resource" | "tags" | "retrievedCount" | "lastRetrievedAt" | "createdAt" | "updatedAt">;

export function KnowledgeDocumentList({ documents, onOpen }: {
  documents: KnowledgeDocumentSummary[];
  onOpen(id: string): void;
}) {
  return <div className="divide-y divide-[rgb(var(--border)/0.72)] border-y border-[rgb(var(--border))]">
    {documents.map((document) => <button key={document.id} onClick={() => onOpen(document.id)} className="group grid w-full min-w-0 gap-3 px-1 py-5 text-left transition hover:bg-[rgb(var(--muted)/0.28)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-3">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--muted-foreground))]">{document.kind === "concept" ? document.type || "Concept" : document.kind}</span>
          <h2 className="min-w-0 break-words font-semibold group-hover:text-[rgb(var(--accent))]">{document.title}</h2>
        </div>
        <p className="mt-1 max-w-3xl line-clamp-2 text-sm leading-6 text-[rgb(var(--muted-foreground))]">{document.description || "No description"}</p>
      </div>
      <div className="min-w-0 text-left sm:max-w-72 sm:text-right">
        <p className="break-all font-mono text-[10px] text-[rgb(var(--muted-foreground))]">{document.path}</p>
        {document.retrievedCount ? <p className="mt-1 text-xs text-[rgb(var(--muted-foreground))]">{document.retrievedCount === 1 ? "1 retrieval" : `${document.retrievedCount} retrievals`}</p> : null}
      </div>
    </button>)}
  </div>;
}
