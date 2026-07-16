import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import type { Embedder } from "../memory/embed";
import type { Reranker } from "../memory/rerank";
import { vecToBlob } from "../memory/embed-text";
import { tryLoadVecExtension } from "../memory/vec-extension";
import { applySqliteMigrations } from "../sqlite/migrations";
import { quoteForFts5 } from "../skills/skills-store-helpers";
import { knowledgeMigrations } from "./migrations";
import { extractMarkdownLinks, hashKnowledge, knowledgeChunks, markdownOutline, markdownSection, normalizeKnowledgePath, resolveKnowledgeTarget } from "./markdown";
import { previewOkfImport, renderOkfDocument, slugifyKnowledge, synthesizeRootIndex } from "./okf";
import { bundleFromRow, documentFromRow, proposalFromRow, type KnowledgeBundleRow, type KnowledgeDocumentRow, type KnowledgeProposalRow } from "./rows";
import { validateKnowledgeConcept } from "./validation";
import type { EmbeddingHealthStats, TargetIndexCounts } from "../retrieval/indexing";
import type { KnowledgeBundle, KnowledgeConceptInput, KnowledgeDocument, KnowledgeLink, KnowledgeProposal, KnowledgeRead, KnowledgeSearchResult, OkfFileInput, OkfImportPreview } from "./types";

export interface SqliteKnowledgeStoreOptions {
  embedder?: Embedder;
  reranker?: Reranker;
  log?: (message: string) => void;
  onDirtyIndex?: (input: { knowledge: string[] }) => void;
}

export class SqliteKnowledgeStore {
  private readonly db: Database;
  private readonly embedder: Embedder | null;
  private readonly reranker: Reranker | null;
  private readonly vecEnabled: boolean;
  private readonly onDirtyIndex?: (input: { knowledge: string[] }) => void;

  constructor(dbPath: string, options: SqliteKnowledgeStoreOptions = {}) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.embedder = options.embedder ?? null;
    this.reranker = options.reranker ?? null;
    this.onDirtyIndex = options.onDirtyIndex;
    const vecLoad = this.embedder ? tryLoadVecExtension(this.db, options.log ?? (() => {})) : { ok: false as const };
    applySqliteMigrations(this.db, "knowledge", knowledgeMigrations);
    this.vecEnabled = vecLoad.ok && this.tableExists("knowledge_vec");
  }

  createBundle(input: { name: string; slug?: string; description?: string; enabled?: boolean }): KnowledgeBundle {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const slug = this.availableSlug(slugifyKnowledge(input.slug || input.name));
    this.db.query(`INSERT INTO knowledge_bundles
      (id, name, slug, description, source, enabled, created_at, updated_at)
      VALUES ($id, $name, $slug, $description, 'manual', $enabled, $now, $now)`)
      .run({ $id: id, $name: input.name.trim(), $slug: slug, $description: input.description?.trim() ?? "", $enabled: input.enabled === false ? 0 : 1, $now: now });
    return this.getBundle(id)!;
  }

  bundles(): KnowledgeBundle[] {
    return (this.db.query("SELECT * FROM knowledge_bundles ORDER BY name, id").all() as KnowledgeBundleRow[]).map(bundleFromRow);
  }

  getBundle(id: string): KnowledgeBundle | null {
    const row = this.db.query("SELECT * FROM knowledge_bundles WHERE id = $id").get({ $id: id }) as KnowledgeBundleRow | undefined;
    return row ? bundleFromRow(row) : null;
  }

  setBundleEnabled(id: string, enabled: boolean): KnowledgeBundle {
    this.db.query("UPDATE knowledge_bundles SET enabled = $enabled, updated_at = $now WHERE id = $id")
      .run({ $id: id, $enabled: enabled ? 1 : 0, $now: new Date().toISOString() });
    const bundle = this.getBundle(id);
    if (!bundle) throw new Error("Knowledge bundle not found.");
    return bundle;
  }

  updateBundle(id: string, input: { name: string; description?: string; slug?: string }): KnowledgeBundle {
    const current = this.getBundle(id);
    if (!current) throw new Error("Knowledge bundle not found.");
    if (current.source !== "manual") throw new Error("Imported bundle metadata is managed by its root index.md.");
    const name = requireText(input.name, "name");
    if (name.length > 200 || (input.description?.length ?? 0) > 2_000) throw new Error("Bundle metadata exceeds its size limit.");
    const slug = input.slug === undefined ? current.slug : slugifyKnowledge(input.slug);
    const conflict = this.db.query("SELECT 1 FROM knowledge_bundles WHERE slug=$slug AND id<>$id").get({ $slug: slug, $id: id });
    if (conflict) throw new Error("Another knowledge bundle already uses this slug.");
    this.db.query("UPDATE knowledge_bundles SET name=$name,slug=$slug,description=$description,updated_at=$now WHERE id=$id")
      .run({ $id: id, $name: name, $slug: slug, $description: input.description?.trim() ?? "", $now: new Date().toISOString() });
    return this.getBundle(id)!;
  }

  deleteBundle(id: string): boolean {
    this.clearVectorsForBundle(id);
    return this.db.query("DELETE FROM knowledge_bundles WHERE id = $id").run({ $id: id }).changes > 0;
  }

  documents(bundleId?: string): KnowledgeDocument[] {
    const rows = bundleId
      ? this.db.query("SELECT * FROM knowledge_documents WHERE bundle_id = $bundleId ORDER BY path").all({ $bundleId: bundleId })
      : this.db.query("SELECT * FROM knowledge_documents ORDER BY path").all();
    return (rows as KnowledgeDocumentRow[]).map(documentFromRow);
  }

  getDocument(id: string): KnowledgeDocument | null {
    const row = this.db.query("SELECT * FROM knowledge_documents WHERE id = $id").get({ $id: id }) as KnowledgeDocumentRow | undefined;
    return row ? documentFromRow(row) : null;
  }

  upsertConcept(bundleId: string, input: KnowledgeConceptInput): KnowledgeDocument {
    if (!this.getBundle(bundleId)) throw new Error("Knowledge bundle not found.");
    validateKnowledgeConcept(input);
    const path = normalizeKnowledgePath(input.path);
    if (!path.endsWith(".md") || /(^|\/)(index|log)\.md$/i.test(path)) throw new Error("Concept paths must end in .md and may not use reserved filenames.");
    const conceptId = input.conceptId?.trim() || path.slice(0, -3);
    if (conceptId.endsWith(".md") || normalizeKnowledgePath(`${conceptId}.md`) !== `${conceptId}.md`) throw new Error("Concept IDs must be normalized bundle-relative paths without .md.");
    const existing = input.id ? this.getDocument(input.id) : this.documentByPath(bundleId, path);
    if (existing && existing.bundleId !== bundleId) throw new Error("Knowledge concept does not belong to this bundle.");
    const now = new Date().toISOString();
    const frontmatter = { ...(existing?.frontmatter ?? {}), ...(input.frontmatter ?? {}), timestamp: now };
    const contentHash = hashKnowledge(JSON.stringify({ ...input, path, conceptId, frontmatter }));
    this.db.exec("SAVEPOINT knowledge_concept;");
    try {
      const id = existing?.id ?? input.id ?? crypto.randomUUID();
      this.writeDocument({
        id, bundleId, path, kind: "concept", conceptId, type: requireText(input.type, "type"),
        title: requireText(input.title, "title"), description: input.description?.trim() ?? "", resource: input.resource?.trim() || null,
        tags: cleanTags(input.tags), frontmatter, body: input.body, contentHash,
        retrievedCount: existing?.retrievedCount ?? 0, lastRetrievedAt: existing?.lastRetrievedAt ?? null,
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      });
      this.rebuildBundleDerived(bundleId);
      this.db.query("UPDATE knowledge_bundles SET updated_at = $now WHERE id = $id").run({ $id: bundleId, $now: now });
      this.db.exec("RELEASE knowledge_concept;");
      this.onDirtyIndex?.({ knowledge: [id] });
      return this.getDocument(id)!;
    } catch (error) { this.db.exec("ROLLBACK TO knowledge_concept; RELEASE knowledge_concept;"); throw error; }
  }

  deleteDocument(id: string): boolean {
    const existing = this.getDocument(id);
    if (!existing) return false;
    this.clearVectorsForDocument(id);
    const result = this.db.query("DELETE FROM knowledge_documents WHERE id = $id").run({ $id: id });
    if (result.changes) this.rebuildBundleDerived(existing.bundleId);
    return result.changes > 0;
  }

  previewOkf(files: readonly OkfFileInput[], bundleId?: string): OkfImportPreview {
    return previewOkfImport(files, bundleId ? this.documents(bundleId) : []);
  }

  importOkf(preview: OkfImportPreview, input: { bundleId?: string; confirmRemoved?: boolean } = {}): KnowledgeBundle {
    if (preview.invalid.length) throw new Error("Fix invalid OKF documents before importing.");
    if (preview.removed.length && !input.confirmRemoved) throw new Error("Confirm removal of documents missing from the new snapshot.");
    const now = new Date().toISOString();
    const existingBundle = input.bundleId ? this.getBundle(input.bundleId) : null;
    if (input.bundleId && !existingBundle) throw new Error("Knowledge bundle not found.");
    const bundleId = existingBundle?.id ?? crypto.randomUUID();
    const existingDocs = new Map(this.documents(bundleId).map((doc) => [doc.path, doc]));
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      if (existingBundle) {
        this.db.query(`UPDATE knowledge_bundles SET name=$name, description=$description, source='okf', okf_version=$version,
          import_hash=$hash, updated_at=$now, imported_at=$now WHERE id=$id`)
          .run({ $id: bundleId, $name: preview.name, $description: preview.description, $version: preview.okfVersion, $hash: preview.importHash, $now: now });
      } else {
        this.db.query(`INSERT INTO knowledge_bundles
          (id,name,slug,description,source,okf_version,enabled,import_hash,created_at,updated_at,imported_at)
          VALUES ($id,$name,$slug,$description,'okf',$version,1,$hash,$now,$now,$now)`)
          .run({ $id: bundleId, $name: preview.name, $slug: this.availableSlug(preview.slug), $description: preview.description, $version: preview.okfVersion, $hash: preview.importHash, $now: now });
      }
      const wanted = new Set(preview.files.map((file) => file.path));
      for (const document of preview.files) {
        const existing = existingDocs.get(document.path);
        this.writeDocument({ ...document, id: existing?.id ?? crypto.randomUUID(), bundleId,
          retrievedCount: existing?.retrievedCount ?? 0, lastRetrievedAt: existing?.lastRetrievedAt ?? null,
          createdAt: existing?.createdAt ?? now, updatedAt: existing?.contentHash === document.contentHash ? existing.updatedAt : now });
      }
      for (const document of existingDocs.values()) if (!wanted.has(document.path)) {
        this.clearVectorsForDocument(document.id);
        this.db.query("DELETE FROM knowledge_documents WHERE id=$id").run({ $id: document.id });
      }
      this.rebuildBundleDerived(bundleId);
      this.db.exec("COMMIT;");
    } catch (error) { this.db.exec("ROLLBACK;"); throw error; }
    this.onDirtyIndex?.({ knowledge: this.documents(bundleId).map((doc) => doc.id) });
    return this.getBundle(bundleId)!;
  }

  async exportOkf(bundleId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const bundle = this.getBundle(bundleId);
    if (!bundle) throw new Error("Knowledge bundle not found.");
    const documents = this.documents(bundleId);
    const files: Record<string, string> = Object.fromEntries(documents.map((doc) => [doc.path, renderOkfDocument(doc)]));
    if (!files["index.md"]) files["index.md"] = synthesizeRootIndex(bundle.name, documents);
    const archive = new Bun.Archive(Object.fromEntries(Object.entries(files).map(([file, content]) => [`${bundle.slug}/${file}`, content])), { compress: "gzip" });
    return { filename: `${bundle.slug}-okf.tar.gz`, bytes: await archive.bytes() };
  }

  search(query: string, options: { bundleId?: string; type?: string; tags?: string[]; limit?: number; increment?: boolean } = {}): KnowledgeSearchResult[] {
    const limit = Math.min(10, Math.max(1, options.limit ?? 5));
    const match = query.split(/\s+/).map(quoteForFts5).filter(Boolean).join(" OR ");
    if (!match) return [];
    const filters = this.searchFilters(options);
    let rows: Array<KnowledgeDocumentRow & { excerpt: string }> = [];
    try {
      rows = this.db.query(`SELECT d.*, c.text AS excerpt FROM knowledge_chunks_fts f
        JOIN knowledge_chunks c ON c.id=f.rowid JOIN knowledge_documents d ON d.id=c.document_id
        JOIN knowledge_bundles b ON b.id=d.bundle_id
        WHERE knowledge_chunks_fts MATCH $match AND d.document_kind='concept' AND b.enabled=1 ${filters.sql}
        ORDER BY rank LIMIT $candidateLimit`).all({ $match: match, $candidateLimit: limit * 8, ...filters.params } as never) as typeof rows;
    } catch {
      rows = this.db.query(`SELECT d.*, d.description AS excerpt FROM knowledge_documents d
        JOIN knowledge_bundles b ON b.id=d.bundle_id WHERE d.document_kind='concept' AND b.enabled=1
        AND (LOWER(d.title) LIKE $like OR LOWER(d.description) LIKE $like OR LOWER(d.body) LIKE $like) ${filters.sql}
        ORDER BY d.updated_at DESC LIMIT $candidateLimit`).all({ $like: `%${query.toLowerCase()}%`, $candidateLimit: limit * 8, ...filters.params } as never) as typeof rows;
    }
    const seen = new Set<string>();
    const matches = rows.filter((row) => !seen.has(row.id) && (seen.add(row.id), true)).slice(0, limit);
    if (options.increment !== false) this.incrementRetrieved(matches.map((row) => row.id));
    const bundleNames = new Map(this.bundles().map((bundle) => [bundle.id, bundle.name]));
    return matches.map((row) => {
      const document = documentFromRow(row);
      return { id: document.id, bundleId: document.bundleId, bundleName: bundleNames.get(document.bundleId) ?? "",
        path: document.path, conceptId: document.conceptId, type: document.type, title: document.title,
        description: document.description, resource: document.resource, tags: document.tags, updatedAt: document.updatedAt,
        excerpt: row.excerpt.slice(0, 600) };
    });
  }

  async searchSemantic(query: string, options: { bundleId?: string; type?: string; tags?: string[]; limit?: number; increment?: boolean } = {}): Promise<KnowledgeSearchResult[]> {
    if (!this.isHybridReady() || !this.embedder) return this.search(query, options);
    const limit = Math.min(10, Math.max(1, options.limit ?? 5));
    const lexical = this.search(query, { ...options, limit: 10, increment: false });
    const candidates = new Map(lexical.map((result) => [result.id, result]));
    try {
      const embedding = await this.embedder.embedQuery(query);
      const rows = this.db.query(`SELECT d.*, c.text excerpt FROM knowledge_vec v
        JOIN knowledge_chunks c ON c.id=v.rowid JOIN knowledge_documents d ON d.id=c.document_id
        JOIN knowledge_bundles b ON b.id=d.bundle_id
        WHERE v.embedding MATCH $embedding AND k=30 AND b.enabled=1 AND d.document_kind='concept'
        ORDER BY v.distance`).all({ $embedding: vecToBlob(embedding) } as never) as Array<KnowledgeDocumentRow & { excerpt: string }>;
      const names = new Map(this.bundles().map((bundle) => [bundle.id, bundle.name]));
      for (const row of rows) {
        const document = documentFromRow(row);
        if (!matchesOptions(document, options) || candidates.has(document.id)) continue;
        candidates.set(document.id, searchResult(document, names.get(document.bundleId) ?? "", row.excerpt));
      }
    } catch {
      return this.search(query, options);
    }
    let results = [...candidates.values()];
    if (this.reranker?.available() && results.length > 1) {
      try {
        const scores = await this.reranker.rerank(query, results.map((item) => `${item.title}\n${item.description}\n${item.excerpt}`));
        if (scores.length === results.length) results = results.map((item, index) => ({ item, score: scores[index] })).sort((a, b) => b.score - a.score).map(({ item }) => item);
      } catch {}
    }
    results = results.slice(0, limit);
    if (options.increment !== false) this.incrementRetrieved(results.map((item) => item.id));
    return results;
  }

  read(id: string, options: { section?: string; increment?: boolean; maxBytes?: number } = {}): KnowledgeRead | null {
    const document = this.getDocument(id);
    if (!document) return null;
    const section = options.section ? markdownSection(document.body, options.section) : document.body;
    if (options.section && section === null) return null;
    const capped = capUtf8(section ?? "", Math.min(1_048_576, Math.max(1, options.maxBytes ?? 32_768)));
    if (options.increment !== false) this.incrementRetrieved([id]);
    const links = this.linksFor(id);
    return { ...document, body: capped.value, outline: markdownOutline(document.body), citations: links.filter((link) => link.kind === "citation"),
      links: links.filter((link) => link.kind !== "citation"), backlinks: this.backlinksFor(id), truncated: capped.truncated };
  }

  list(bundleId: string, pathPrefix = "", limit = 50): KnowledgeDocument[] {
    const prefix = pathPrefix ? `${normalizeKnowledgePath(pathPrefix).replace(/\/$/, "")}/` : "";
    return this.documents(bundleId).filter((doc) => doc.path.startsWith(prefix)).slice(0, Math.min(100, Math.max(1, limit)));
  }

  proposals(status?: KnowledgeProposal["status"]): KnowledgeProposal[] {
    const rows = status
      ? this.db.query("SELECT * FROM knowledge_proposals WHERE status=$status ORDER BY created_at DESC").all({ $status: status })
      : this.db.query("SELECT * FROM knowledge_proposals ORDER BY created_at DESC").all();
    return (rows as KnowledgeProposalRow[]).map(proposalFromRow);
  }

  propose(input: { bundleId: string; operation: "create" | "update"; conceptId: string; fields: KnowledgeConceptInput; rationale: string; evidence: string[]; sourceSessionId?: string }): KnowledgeProposal {
    validateKnowledgeConcept(input.fields);
    if (!this.getBundle(input.bundleId)) throw new Error("Knowledge bundle not found.");
    const conceptId = requireText(input.conceptId, "conceptId");
    if (conceptId.length > 500 || conceptId.endsWith(".md") || normalizeKnowledgePath(`${conceptId}.md`) !== `${conceptId}.md`) throw new Error("Concept IDs must be normalized bundle-relative paths without .md.");
    const rationale = requireText(input.rationale, "rationale");
    if (rationale.length > 4_000) throw new Error("rationale is limited to 4000 characters.");
    if (input.evidence.length > 50 || input.evidence.some((item) => typeof item !== "string" || item.length > 4_000)) throw new Error("Evidence is limited to 50 entries of 4000 characters.");
    const target = input.operation === "update" ? this.documentByConceptId(input.bundleId, conceptId) : null;
    if (input.operation === "update" && !target) throw new Error("The concept to update was not found.");
    if (input.operation === "create" && this.documentByConceptId(input.bundleId, conceptId)) throw new Error("A concept with this ID already exists.");
    if (input.operation === "create" && this.documentByPath(input.bundleId, normalizeKnowledgePath(input.fields.path))) throw new Error("A concept with this path already exists.");
    const fields = { ...input.fields, conceptId };
    const id = crypto.randomUUID();
    this.db.query(`INSERT INTO knowledge_proposals
      (id,bundle_id,operation,target_document_id,concept_id,payload_json,rationale,evidence_json,source_session_id,base_content_hash,status,created_at)
      VALUES ($id,$bundleId,$operation,$targetId,$conceptId,$payload,$rationale,$evidence,$sessionId,$baseHash,'pending',$now)`)
      .run({ $id: id, $bundleId: input.bundleId, $operation: input.operation, $targetId: target?.id ?? null,
        $conceptId: conceptId, $payload: JSON.stringify(fields), $rationale: rationale,
        $evidence: JSON.stringify(input.evidence), $sessionId: input.sourceSessionId ?? null, $baseHash: target?.contentHash ?? null, $now: new Date().toISOString() });
    return this.proposal(id)!;
  }

  acceptProposal(id: string): KnowledgeProposal {
    const proposal = this.proposal(id);
    if (!proposal || proposal.status !== "pending") throw new Error("Pending knowledge proposal not found.");
    const target = proposal.targetDocumentId ? this.getDocument(proposal.targetDocumentId) : null;
    if (proposal.operation === "update" && (!target || target.contentHash !== proposal.baseContentHash)) {
      this.resolveProposal(id, "stale");
      return this.proposal(id)!;
    }
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      this.upsertConcept(proposal.bundleId, { ...proposal.fields, id: target?.id });
      this.resolveProposal(id, "accepted");
      this.db.exec("COMMIT;");
    } catch (error) { this.db.exec("ROLLBACK;"); throw error; }
    return this.proposal(id)!;
  }

  rejectProposal(id: string): KnowledgeProposal { this.resolveProposal(id, "rejected"); return this.proposal(id)!; }

  resetAll(): void {
    this.db.exec("BEGIN IMMEDIATE;");
    try { if (this.vecEnabled) this.db.query("DELETE FROM knowledge_vec").run(); this.db.query("DELETE FROM knowledge_bundles").run(); this.db.exec("COMMIT;"); }
    catch (error) { this.db.exec("ROLLBACK;"); throw error; }
  }

  embeddingStats(): EmbeddingHealthStats {
    const row = this.db.query("SELECT COUNT(*) total, SUM(CASE WHEN model_id IS NOT NULL THEN 1 ELSE 0 END) embedded FROM knowledge_chunks").get() as { total: number; embedded: number };
    return { total: row?.total ?? 0, embedded: row?.embedded ?? 0, stale: Math.max(0, (row?.total ?? 0) - (row?.embedded ?? 0)) };
  }

  async backfillEmbeddings(): Promise<{ done: number; skipped: number }> {
    if (!this.embedder || !this.vecEnabled || !this.embedder.available()) return { done: 0, skipped: this.documents().length };
    let done = 0; let skipped = 0;
    for (const document of this.documents()) { const result = await this.indexEmbeddings([document.id]); done += result.indexed; skipped += result.skipped; }
    return { done, skipped };
  }

  async indexEmbeddings(ids: readonly string[]): Promise<TargetIndexCounts> {
    const counts: TargetIndexCounts = { indexed: 0, skipped: 0, missing: 0, failed: 0 };
    if (!this.embedder || !this.vecEnabled || !this.embedder.available()) return { ...counts, failed: ids.length };
    for (const id of ids) {
      const chunks = this.db.query("SELECT id,text,body_hash,model_id,dim FROM knowledge_chunks WHERE document_id=$id").all({ $id: id }) as Array<{ id: number; text: string; body_hash: string; model_id: string | null; dim: number | null }>;
      if (!chunks.length) { counts.missing += 1; continue; }
      const stale = chunks.filter((chunk) => chunk.model_id !== this.embedder!.modelId || chunk.dim !== this.embedder!.dim);
      if (!stale.length) { counts.skipped += 1; continue; }
      try {
        const vectors = await this.embedder.embedMany(stale.map((chunk) => chunk.text));
        this.db.transaction(() => stale.forEach((chunk, index) => {
          this.db.query("DELETE FROM knowledge_vec WHERE rowid=$id").run({ $id: chunk.id } as never);
          this.db.query("INSERT INTO knowledge_vec(rowid,embedding) VALUES ($id,$embedding)").run({ $id: chunk.id, $embedding: new Uint8Array(vectors[index].buffer) } as never);
          this.db.query("UPDATE knowledge_chunks SET model_id=$model,dim=$dim,embedded_at=$now WHERE id=$id")
            .run({ $id: chunk.id, $model: this.embedder!.modelId, $dim: this.embedder!.dim, $now: new Date().toISOString() });
        }))(); counts.indexed += 1;
      } catch { counts.failed += 1; }
    }
    return counts;
  }

  isHybridReady(): boolean { return this.vecEnabled && Boolean(this.embedder?.available()); }
  isRerankReady(): boolean { return this.isHybridReady() && Boolean(this.reranker?.available()); }
  close(): void { this.db.close(); }

  private writeDocument(document: KnowledgeDocument): void {
    this.db.query(`INSERT INTO knowledge_documents
      (id,bundle_id,path,document_kind,concept_id,type,title,description,resource,tags_json,frontmatter_json,body,content_hash,retrieved_count,last_retrieved_at,created_at,updated_at)
      VALUES ($id,$bundleId,$path,$kind,$conceptId,$type,$title,$description,$resource,$tags,$frontmatter,$body,$hash,$retrieved,$lastRetrieved,$created,$updated)
      ON CONFLICT(id) DO UPDATE SET bundle_id=excluded.bundle_id,path=excluded.path,document_kind=excluded.document_kind,concept_id=excluded.concept_id,
        type=excluded.type,title=excluded.title,description=excluded.description,resource=excluded.resource,tags_json=excluded.tags_json,
        frontmatter_json=excluded.frontmatter_json,body=excluded.body,content_hash=excluded.content_hash,updated_at=excluded.updated_at`)
      .run({ $id: document.id, $bundleId: document.bundleId, $path: document.path, $kind: document.kind, $conceptId: document.conceptId,
        $type: document.type, $title: document.title, $description: document.description, $resource: document.resource,
        $tags: JSON.stringify(document.tags), $frontmatter: JSON.stringify(document.frontmatter), $body: document.body, $hash: document.contentHash,
        $retrieved: document.retrievedCount, $lastRetrieved: document.lastRetrievedAt, $created: document.createdAt, $updated: document.updatedAt });
  }

  private rebuildBundleDerived(bundleId: string): void {
    const docs = this.documents(bundleId);
    const byPath = new Map(docs.map((doc) => [doc.path, doc]));
    const deleteLinks = this.db.query("DELETE FROM knowledge_links WHERE source_document_id=$id");
    const insertLink = this.db.query(`INSERT INTO knowledge_links(source_document_id,raw_target,target_document_id,label,kind)
      VALUES ($source,$raw,$target,$label,$kind)`);
    const deleteChunks = this.db.query("DELETE FROM knowledge_chunks WHERE document_id=$id");
    const insertChunk = this.db.query(`INSERT INTO knowledge_chunks(document_id,chunk_key,text,body_hash)
      VALUES ($document,$key,$text,$hash)`);
    for (const doc of docs) {
      this.clearVectorsForDocument(doc.id); deleteLinks.run({ $id: doc.id }); deleteChunks.run({ $id: doc.id });
      for (const link of extractMarkdownLinks(doc.body)) {
        const targetPath = resolveKnowledgeTarget(doc.path, link.target);
        const target = targetPath ? byPath.get(targetPath) : null;
        const external = targetPath === null;
        insertLink.run({ $source: doc.id, $raw: link.target, $target: target?.id ?? null, $label: link.label,
          $kind: link.citation ? "citation" : external ? "external" : target ? "internal" : "broken" });
      }
      for (const chunk of knowledgeChunks(doc)) insertChunk.run({ $document: doc.id, $key: chunk.key, $text: chunk.text, $hash: hashKnowledge(chunk.text) });
    }
  }

  private linksFor(id: string): KnowledgeLink[] {
    return this.db.query(`SELECT id,source_document_id sourceDocumentId,raw_target rawTarget,target_document_id targetDocumentId,label,kind
      FROM knowledge_links WHERE source_document_id=$id ORDER BY id`).all({ $id: id }) as KnowledgeLink[];
  }

  private backlinksFor(id: string): KnowledgeRead["backlinks"] {
    return this.db.query(`SELECT l.id,l.source_document_id sourceDocumentId,l.raw_target rawTarget,l.target_document_id targetDocumentId,l.label,l.kind,
      d.title sourceTitle,d.path sourcePath FROM knowledge_links l JOIN knowledge_documents d ON d.id=l.source_document_id
      WHERE l.target_document_id=$id ORDER BY d.title`).all({ $id: id }) as KnowledgeRead["backlinks"];
  }

  private incrementRetrieved(ids: readonly string[]): void {
    const update = this.db.query("UPDATE knowledge_documents SET retrieved_count=retrieved_count+1,last_retrieved_at=$now WHERE id=$id");
    const now = new Date().toISOString();
    for (const id of new Set(ids)) update.run({ $id: id, $now: now });
  }

  private documentByPath(bundleId: string, path: string): KnowledgeDocument | null {
    const row = this.db.query("SELECT * FROM knowledge_documents WHERE bundle_id=$bundleId AND path=$path").get({ $bundleId: bundleId, $path: path }) as KnowledgeDocumentRow | undefined;
    return row ? documentFromRow(row) : null;
  }

  private documentByConceptId(bundleId: string, conceptId: string): KnowledgeDocument | null {
    const row = this.db.query("SELECT * FROM knowledge_documents WHERE bundle_id=$bundleId AND concept_id=$conceptId").get({ $bundleId: bundleId, $conceptId: conceptId }) as KnowledgeDocumentRow | undefined;
    return row ? documentFromRow(row) : null;
  }

  private proposal(id: string): KnowledgeProposal | null {
    const row = this.db.query("SELECT * FROM knowledge_proposals WHERE id=$id").get({ $id: id }) as KnowledgeProposalRow | undefined;
    return row ? proposalFromRow(row) : null;
  }

  private resolveProposal(id: string, status: "accepted" | "rejected" | "stale"): void {
    this.db.query("UPDATE knowledge_proposals SET status=$status,resolved_at=$now WHERE id=$id AND status='pending'")
      .run({ $id: id, $status: status, $now: new Date().toISOString() });
  }

  private searchFilters(options: { bundleId?: string; type?: string; tags?: string[] }): { sql: string; params: Record<string, string> } {
    const clauses: string[] = []; const params: Record<string, string> = {};
    if (options.bundleId) { clauses.push("d.bundle_id=$bundleId"); params.$bundleId = options.bundleId; }
    if (options.type) { clauses.push("LOWER(d.type)=LOWER($type)"); params.$type = options.type; }
    for (const [index, tag] of (options.tags ?? []).entries()) { clauses.push(`LOWER(d.tags_json) LIKE $tag${index}`); params[`$tag${index}`] = `%\"${tag.toLowerCase()}\"%`; }
    return { sql: clauses.length ? `AND ${clauses.join(" AND ")}` : "", params };
  }

  private availableSlug(base: string): string {
    let slug = base; let suffix = 2;
    while (this.db.query("SELECT 1 FROM knowledge_bundles WHERE slug=$slug").get({ $slug: slug })) slug = `${base}-${suffix++}`;
    return slug;
  }

  private clearVectorsForBundle(bundleId: string): void {
    if (!this.vecEnabled) return;
    const rows = this.db.query(`SELECT c.id FROM knowledge_chunks c JOIN knowledge_documents d ON d.id=c.document_id WHERE d.bundle_id=$id`).all({ $id: bundleId }) as Array<{ id: number }>;
    const remove = this.db.query("DELETE FROM knowledge_vec WHERE rowid=$id"); for (const row of rows) remove.run({ $id: row.id } as never);
  }

  private clearVectorsForDocument(documentId: string): void {
    if (!this.vecEnabled) return;
    const rows = this.db.query("SELECT id FROM knowledge_chunks WHERE document_id=$id").all({ $id: documentId }) as Array<{ id: number }>;
    const remove = this.db.query("DELETE FROM knowledge_vec WHERE rowid=$id"); for (const row of rows) remove.run({ $id: row.id } as never);
  }

  private tableExists(name: string): boolean { return Boolean(this.db.query("SELECT name FROM sqlite_master WHERE name=$name").get({ $name: name })); }
}

function cleanTags(tags?: readonly string[]): string[] { return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))]; }
function requireText(value: string, field: string): string { const clean = value.trim(); if (!clean) throw new Error(`${field} is required.`); return clean; }
function capUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(value); if (bytes.length <= maxBytes) return { value, truncated: false };
  return { value: new TextDecoder().decode(bytes.slice(0, maxBytes)), truncated: true };
}

function matchesOptions(document: KnowledgeDocument, options: { bundleId?: string; type?: string; tags?: string[] }): boolean {
  return (!options.bundleId || document.bundleId === options.bundleId)
    && (!options.type || document.type?.toLowerCase() === options.type.toLowerCase())
    && (options.tags ?? []).every((tag) => document.tags.some((value) => value.toLowerCase() === tag.toLowerCase()));
}

function searchResult(document: KnowledgeDocument, bundleName: string, excerpt: string): KnowledgeSearchResult {
  return { id: document.id, bundleId: document.bundleId, bundleName, path: document.path, conceptId: document.conceptId,
    type: document.type, title: document.title, description: document.description, resource: document.resource,
    tags: document.tags, updatedAt: document.updatedAt, excerpt: excerpt.slice(0, 600) };
}
