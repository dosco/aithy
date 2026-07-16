import { Check, GitPullRequestArrow, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { KnowledgeBundle, KnowledgeProposalReview } from "../../../src/knowledge/types";

export function KnowledgeProposals({ proposals, bundles, onResolve }: {
  proposals: KnowledgeProposalReview[]; bundles: KnowledgeBundle[];
  onResolve(id: string, decision: "accept" | "reject"): Promise<void>;
}) {
  if (!proposals.length) return null;
  return <details className="mb-6 border-y border-violet-500/25">
    <summary className="flex cursor-pointer list-none items-center gap-3 py-3"><GitPullRequestArrow className="h-4 w-4 text-violet-500" /><span className="font-medium">{proposals.length === 1 ? "1 proposal awaiting review" : `${proposals.length} proposals awaiting review`}</span><span className="ml-auto text-xs text-violet-600">Review</span></summary>
    <div className="divide-y divide-violet-500/20 border-t border-violet-500/20">{proposals.map((proposal) => <article key={proposal.id} className="min-w-0 py-3 pl-7">
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"><div className="min-w-0"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--muted-foreground))]">{proposal.operation} · {bundles.find((bundle) => bundle.id === proposal.bundleId)?.name ?? "Unknown bundle"}</p><h3 className="mt-1 font-semibold">{proposal.fields.title}</h3><p className="mt-1 text-sm leading-6 text-[rgb(var(--muted-foreground))]">{proposal.rationale}</p></div><div className="flex gap-2"><Button size="sm" variant="ghost" className="rounded-lg" onClick={() => void onResolve(proposal.id, "reject")}><X className="h-4 w-4" /> Reject</Button><Button size="sm" className="rounded-lg" onClick={() => void onResolve(proposal.id, "accept")}><Check className="h-4 w-4" /> Accept update</Button></div></div>
      <FieldDiff proposal={proposal} />
      {proposal.evidence.length ? <p className="mt-3 break-all text-xs text-[rgb(var(--muted-foreground))]"><strong>Evidence:</strong> {proposal.evidence.join(" · ")}</p> : null}
    </article>)}</div>
  </details>;
}

function FieldDiff({ proposal }: { proposal: KnowledgeProposalReview }) {
  return <details className="mt-3 min-w-0"><summary className="cursor-pointer text-xs font-medium text-violet-600">Review changes</summary><div className="mt-3 min-w-0 border-l border-[rgb(var(--border))] pl-4"><dl className="grid gap-2 text-sm sm:grid-cols-2"><Diff label="Path" before={proposal.currentFields?.path} after={proposal.fields.path} /><Diff label="Type" before={proposal.currentFields?.type} after={proposal.fields.type} /><Diff label="Description" before={proposal.currentFields?.description} after={proposal.fields.description} /><Diff label="Resource" before={proposal.currentFields?.resource} after={proposal.fields.resource} /></dl>{proposal.currentFields ? <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap border-l-2 border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-xs"><span className="text-red-600">- </span>{proposal.currentFields.body}</pre> : null}<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap border-l-2 border-emerald-500/30 bg-emerald-500/5 px-3 py-2 font-mono text-xs"><span className="text-emerald-600">+ </span>{proposal.fields.body}</pre>{proposal.previewTruncated ? <p className="mt-2 text-xs text-amber-600">Diff preview truncated at 16 KiB per body.</p> : null}</div></details>;
}
function Diff({ label, before, after }: { label: string; before?: string; after?: string }) { return <div><dt className="text-[10px] uppercase tracking-wide text-[rgb(var(--muted-foreground))]">{label}</dt>{before !== undefined ? <dd className="font-mono text-xs text-red-600">- {before || "—"}</dd> : null}<dd className="font-mono text-xs text-emerald-600">+ {after || "—"}</dd></div>; }
