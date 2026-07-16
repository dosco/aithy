export type KnowledgeBundleSource = "manual" | "okf";
export type KnowledgeDocumentKind = "concept" | "index" | "log";
export type KnowledgeLinkKind = "internal" | "broken" | "external" | "citation";
export type KnowledgeProposalStatus = "pending" | "accepted" | "rejected" | "stale";
export type KnowledgeJsonValue = string | number | boolean | null | KnowledgeJsonValue[] | { [key: string]: KnowledgeJsonValue };

export interface KnowledgeBundle {
  id: string;
  name: string;
  slug: string;
  description: string;
  source: KnowledgeBundleSource;
  okfVersion: string | null;
  enabled: boolean;
  importHash: string | null;
  createdAt: string;
  updatedAt: string;
  importedAt: string | null;
}

export interface KnowledgeDocument {
  id: string;
  bundleId: string;
  path: string;
  kind: KnowledgeDocumentKind;
  conceptId: string | null;
  type: string | null;
  title: string;
  description: string;
  resource: string | null;
  tags: string[];
  frontmatter: Record<string, KnowledgeJsonValue>;
  body: string;
  contentHash: string;
  retrievedCount: number;
  lastRetrievedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeLink {
  id: number;
  sourceDocumentId: string;
  rawTarget: string;
  targetDocumentId: string | null;
  label: string;
  kind: KnowledgeLinkKind;
}

export interface KnowledgeRead extends KnowledgeDocument {
  outline: Array<{ depth: number; title: string; anchor: string }>;
  citations: KnowledgeLink[];
  links: KnowledgeLink[];
  backlinks: Array<KnowledgeLink & { sourceTitle: string; sourcePath: string }>;
  truncated: boolean;
}

export interface KnowledgeSearchResult {
  id: string;
  bundleId: string;
  bundleName: string;
  path: string;
  conceptId: string | null;
  type: string | null;
  title: string;
  description: string;
  resource: string | null;
  tags: string[];
  updatedAt: string;
  excerpt: string;
}

export interface KnowledgeProposal {
  id: string;
  bundleId: string;
  operation: "create" | "update";
  targetDocumentId: string | null;
  conceptId: string;
  fields: KnowledgeConceptInput;
  rationale: string;
  evidence: string[];
  sourceSessionId: string | null;
  baseContentHash: string | null;
  status: KnowledgeProposalStatus;
  createdAt: string;
  resolvedAt: string | null;
}

export interface KnowledgeProposalReview extends KnowledgeProposal {
  currentFields: KnowledgeConceptInput | null;
  previewTruncated: boolean;
}

export interface KnowledgeConceptInput {
  id?: string;
  path: string;
  conceptId?: string;
  type: string;
  title: string;
  description?: string;
  resource?: string;
  tags?: string[];
  frontmatter?: Record<string, KnowledgeJsonValue>;
  body: string;
}

export interface OkfFileInput { path: string; content: string }

export interface OkfPreviewDocument {
  path: string;
  kind: KnowledgeDocumentKind;
  conceptId: string | null;
  type: string | null;
  title: string;
  description: string;
  resource: string | null;
  tags: string[];
  frontmatter: Record<string, KnowledgeJsonValue>;
  body: string;
  contentHash: string;
}

export interface OkfImportPreview {
  name: string;
  slug: string;
  description: string;
  okfVersion: string;
  files: OkfPreviewDocument[];
  added: string[];
  changed: string[];
  removed: string[];
  invalid: Array<{ path: string; error: string }>;
  brokenLinks: Array<{ path: string; target: string }>;
  warnings: string[];
  importHash: string;
}
