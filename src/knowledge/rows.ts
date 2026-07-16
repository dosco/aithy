import type { KnowledgeBundle, KnowledgeDocument, KnowledgeJsonValue, KnowledgeProposal } from "./types";

export interface KnowledgeBundleRow {
  id: string; name: string; slug: string; description: string; source: "manual" | "okf";
  okf_version: string | null; enabled: number; import_hash: string | null;
  created_at: string; updated_at: string; imported_at: string | null;
}

export interface KnowledgeDocumentRow {
  id: string; bundle_id: string; path: string; document_kind: "concept" | "index" | "log";
  concept_id: string | null; type: string | null; title: string; description: string;
  resource: string | null; tags_json: string; frontmatter_json: string; body: string;
  content_hash: string; retrieved_count: number; last_retrieved_at: string | null;
  created_at: string; updated_at: string;
}

export interface KnowledgeProposalRow {
  id: string; bundle_id: string; operation: "create" | "update"; target_document_id: string | null;
  concept_id: string; payload_json: string; rationale: string; evidence_json: string;
  source_session_id: string | null; base_content_hash: string | null;
  status: "pending" | "accepted" | "rejected" | "stale"; created_at: string; resolved_at: string | null;
}

export function bundleFromRow(row: KnowledgeBundleRow): KnowledgeBundle {
  return {
    id: row.id, name: row.name, slug: row.slug, description: row.description, source: row.source,
    okfVersion: row.okf_version, enabled: row.enabled === 1, importHash: row.import_hash,
    createdAt: row.created_at, updatedAt: row.updated_at, importedAt: row.imported_at,
  };
}

export function documentFromRow(row: KnowledgeDocumentRow): KnowledgeDocument {
  return {
    id: row.id, bundleId: row.bundle_id, path: row.path, kind: row.document_kind,
    conceptId: row.concept_id, type: row.type, title: row.title, description: row.description,
    resource: row.resource, tags: parseArray(row.tags_json), frontmatter: parseObject(row.frontmatter_json),
    body: row.body, contentHash: row.content_hash, retrievedCount: row.retrieved_count,
    lastRetrievedAt: row.last_retrieved_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function proposalFromRow(row: KnowledgeProposalRow): KnowledgeProposal {
  return {
    id: row.id, bundleId: row.bundle_id, operation: row.operation, targetDocumentId: row.target_document_id,
    conceptId: row.concept_id, fields: parseObject(row.payload_json) as unknown as KnowledgeProposal["fields"],
    rationale: row.rationale, evidence: parseArray(row.evidence_json), sourceSessionId: row.source_session_id,
    baseContentHash: row.base_content_hash, status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at,
  };
}

function parseArray(raw: string): string[] {
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

function parseObject(raw: string): Record<string, KnowledgeJsonValue> {
  try { const value = JSON.parse(raw); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
