import type { SqliteMigration } from "../sqlite/migrations";

export const knowledgeMigrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE knowledge_bundles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK (source IN ('manual', 'okf')),
        okf_version TEXT,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        import_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        imported_at TEXT
      );

      CREATE TABLE knowledge_documents (
        id TEXT PRIMARY KEY,
        bundle_id TEXT NOT NULL REFERENCES knowledge_bundles(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        document_kind TEXT NOT NULL CHECK (document_kind IN ('concept', 'index', 'log')),
        concept_id TEXT,
        type TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        resource TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        frontmatter_json TEXT NOT NULL DEFAULT '{}',
        body TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL,
        retrieved_count INTEGER NOT NULL DEFAULT 0,
        last_retrieved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(bundle_id, path)
      );
      CREATE UNIQUE INDEX knowledge_concept_id_idx
        ON knowledge_documents(bundle_id, concept_id) WHERE concept_id IS NOT NULL;
      CREATE INDEX knowledge_documents_bundle_idx ON knowledge_documents(bundle_id, updated_at DESC);

      CREATE TABLE knowledge_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        raw_target TEXT NOT NULL,
        target_document_id TEXT REFERENCES knowledge_documents(id) ON DELETE SET NULL,
        label TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL CHECK (kind IN ('internal', 'broken', 'external', 'citation'))
      );
      CREATE INDEX knowledge_links_source_idx ON knowledge_links(source_document_id);
      CREATE INDEX knowledge_links_target_idx ON knowledge_links(target_document_id);

      CREATE TABLE knowledge_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        chunk_key TEXT NOT NULL,
        text TEXT NOT NULL,
        body_hash TEXT NOT NULL,
        model_id TEXT,
        dim INTEGER,
        embedded_at TEXT,
        UNIQUE(document_id, chunk_key)
      );
      CREATE INDEX knowledge_chunks_document_idx ON knowledge_chunks(document_id);
      CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(
        text,
        content='knowledge_chunks',
        content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
        INSERT INTO knowledge_chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
        INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
      END;
      CREATE TRIGGER knowledge_chunks_au AFTER UPDATE ON knowledge_chunks BEGIN
        INSERT INTO knowledge_chunks_fts(knowledge_chunks_fts, rowid, text)
        VALUES ('delete', old.id, old.text);
        INSERT INTO knowledge_chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;

      CREATE TABLE knowledge_proposals (
        id TEXT PRIMARY KEY,
        bundle_id TEXT NOT NULL REFERENCES knowledge_bundles(id) ON DELETE CASCADE,
        operation TEXT NOT NULL CHECK (operation IN ('create', 'update')),
        target_document_id TEXT REFERENCES knowledge_documents(id) ON DELETE SET NULL,
        concept_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        rationale TEXT NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '[]',
        source_session_id TEXT,
        base_content_hash TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'stale')),
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE INDEX knowledge_proposals_status_idx ON knowledge_proposals(status, created_at DESC);
    `,
  },
  {
    version: 2,
    precondition: (db) => {
      try { db.query("SELECT vec_version()").get(); return true; } catch { return false; }
    },
    sql: `CREATE VIRTUAL TABLE knowledge_vec USING vec0(embedding float[1024]);`,
  },
];
