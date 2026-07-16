import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import type { KnowledgeDocument, KnowledgeJsonValue, KnowledgeProposal, KnowledgeProposalReview } from "../../src/knowledge/types";
import type { SqliteKnowledgeStore } from "../../src/knowledge/knowledge-store";

const bundleId = z.string().uuid();
const conceptInput = z.object({
  id: z.string().uuid().optional(),
  bundleId,
  path: z.string().min(1).max(500),
  conceptId: z.string().max(500).optional(),
  type: z.string().min(1).max(300),
  title: z.string().min(1).max(500),
  description: z.string().max(4_000).optional(),
  resource: z.string().max(4_000).optional(),
  tags: z.array(z.string().max(200)).max(100).optional(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  body: z.string().max(1_048_576),
});

export const getKnowledgePageState = createServerFn({ method: "GET" }).handler(async () => {
  const runtime = await getAithyRuntime();
  const bundles = runtime.knowledge.bundles();
  const selected = bundles[0]?.id;
  return {
    bundles,
    documents: selected ? runtime.knowledge.documents(selected).map(knowledgeDocumentSummary) : [],
    proposals: runtime.knowledge.proposals("pending").map((proposal) => knowledgeProposalReview(runtime.knowledge, proposal)),
    settings: { ui: runtime.settings.load().ui },
  };
});

export const listKnowledgeDocuments = createServerFn({ method: "GET" })
  .validator(z.object({
    bundleId,
    query: z.string().max(500).optional(),
    type: z.string().max(300).optional(),
    tag: z.string().max(200).optional(),
    sort: z.enum(["recent", "retrieved", "path"]).optional(),
  }))
  .handler(async ({ data }) => {
    const runtime = await getAithyRuntime();
    const query = data.query?.trim().toLowerCase();
    const documents = runtime.knowledge.documents(data.bundleId).filter((document) => {
      if (data.type && document.type !== data.type) return false;
      if (data.tag && !document.tags.includes(data.tag)) return false;
      return !query || [document.title, document.description, document.path, document.type ?? "", document.tags.join(" "), document.body]
        .some((value) => value.toLowerCase().includes(query));
    }).sort((a, b) => data.sort === "retrieved"
      ? b.retrievedCount - a.retrievedCount || a.title.localeCompare(b.title)
      : data.sort === "path" ? a.path.localeCompare(b.path) : b.updatedAt.localeCompare(a.updatedAt));
    return { documents: documents.map(knowledgeDocumentSummary) };
  });

export const readKnowledgeDocument = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => (await getAithyRuntime()).knowledge.read(data.id, { increment: false, maxBytes: 1_048_576 }));

export const createKnowledgeBundle = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().min(1).max(200), slug: z.string().max(100).optional(), description: z.string().max(2_000).optional() }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const bundle = runtime.knowledge.createBundle(data);
    return { bundle, bundles: runtime.knowledge.bundles() };
  });

export const setKnowledgeBundleEnabled = createServerFn({ method: "POST" })
  .validator(z.object({ bundleId, enabled: z.boolean() }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    return (await getAithyRuntime()).knowledge.setBundleEnabled(data.bundleId, data.enabled);
  });

export const updateKnowledgeBundle = createServerFn({ method: "POST" })
  .validator(z.object({ bundleId, name: z.string().min(1).max(200), description: z.string().max(2_000).optional(), slug: z.string().max(100).optional() }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const { bundleId: id, ...fields } = data;
    const bundle = runtime.knowledge.updateBundle(id, fields);
    return { bundle, bundles: runtime.knowledge.bundles() };
  });

export const deleteKnowledgeBundle = createServerFn({ method: "POST" })
  .validator(z.object({ bundleId }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    return { removed: runtime.knowledge.deleteBundle(data.bundleId), bundles: runtime.knowledge.bundles() };
  });

export const upsertKnowledgeConcept = createServerFn({ method: "POST" })
  .validator(conceptInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const { bundleId: id, ...concept } = data;
    return (await getAithyRuntime()).knowledge.upsertConcept(id, {
      ...concept,
      frontmatter: concept.frontmatter as Record<string, KnowledgeJsonValue> | undefined,
    });
  });

export const deleteKnowledgeDocument = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    return { removed: (await getAithyRuntime()).knowledge.deleteDocument(data.id) };
  });

const okfFiles = z.array(z.object({ path: z.string().min(1).max(1_000), content: z.string().max(1_048_576) })).min(1).max(1_000);

export const previewKnowledgeImport = createServerFn({ method: "POST" })
  .validator(z.object({ bundleId: bundleId.optional(), files: okfFiles }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    return (await getAithyRuntime()).knowledge.previewOkf(data.files, data.bundleId);
  });

export const saveKnowledgeImport = createServerFn({ method: "POST" })
  .validator(z.object({ bundleId: bundleId.optional(), files: okfFiles, confirmRemoved: z.boolean().optional() }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const preview = runtime.knowledge.previewOkf(data.files, data.bundleId);
    const bundle = runtime.knowledge.importOkf(preview, { bundleId: data.bundleId, confirmRemoved: data.confirmRemoved });
    return { bundle, bundles: runtime.knowledge.bundles(), documents: runtime.knowledge.documents(bundle.id).map(knowledgeDocumentSummary),
      proposals: runtime.knowledge.proposals("pending").map((proposal) => knowledgeProposalReview(runtime.knowledge, proposal)) };
  });

export const resolveKnowledgeProposal = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), decision: z.enum(["accept", "reject"]) }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const store = (await getAithyRuntime()).knowledge;
    const proposal = data.decision === "accept" ? store.acceptProposal(data.id) : store.rejectProposal(data.id);
    return { proposal, proposals: store.proposals("pending").map((item) => knowledgeProposalReview(store, item)),
      documents: store.documents(proposal.bundleId).map(knowledgeDocumentSummary) };
  });

function knowledgeDocumentSummary(document: KnowledgeDocument) {
  return { id: document.id, bundleId: document.bundleId, path: document.path, kind: document.kind, conceptId: document.conceptId,
    type: document.type, title: document.title, description: document.description.slice(0, 1_000), resource: document.resource,
    tags: document.tags.slice(0, 30), retrievedCount: document.retrievedCount, lastRetrievedAt: document.lastRetrievedAt,
    createdAt: document.createdAt, updatedAt: document.updatedAt };
}

function knowledgeProposalReview(store: SqliteKnowledgeStore, proposal: KnowledgeProposal): KnowledgeProposalReview {
  const current = proposal.targetDocumentId ? store.getDocument(proposal.targetDocumentId) : null;
  const proposedBody = proposal.fields.body.slice(0, 16_000);
  const currentBody = current?.body.slice(0, 16_000) ?? "";
  return { ...proposal, rationale: proposal.rationale.slice(0, 4_000), evidence: proposal.evidence.slice(0, 20).map((item) => item.slice(0, 1_000)),
    fields: { ...proposal.fields, body: proposedBody }, currentFields: current ? { path: current.path, conceptId: current.conceptId ?? undefined,
      type: current.type ?? "", title: current.title, description: current.description, resource: current.resource ?? undefined,
      tags: current.tags, body: currentBody } : null,
    previewTruncated: proposedBody.length !== proposal.fields.body.length || (current ? currentBody.length !== current.body.length : false) };
}
