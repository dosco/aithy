import { mkdirSync } from "node:fs";
import { lstat, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations, type SqliteMigration } from "../sqlite/migrations";
import { basename, safeJoin } from "../workspace/safe-path";
import { mimeTypeForPath, previewForFile } from "./preview";
import {
  normalizeRunOutboxPath,
  relativePathForRunFile,
  resolveOutboxFile,
  resolveRunOutboxWriteTarget,
} from "./paths";
import type { ArtifactEntry, ArtifactPreviewKind, ArtifactPublishResult } from "./types";

interface ArtifactRow {
  id: string;
  session_id: string;
  run_id: string | null;
  sandbox_path: string;
  relative_path: string;
  title: string;
  description: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  preview_kind: ArtifactPreviewKind;
  text_preview: string | null;
  created_at: string;
}

export interface PublishArtifactInput {
  sessionId: string;
  runId?: string | null;
  runOutboxPath: string;
  path: string;
  title?: string | null;
  description?: string | null;
}

export interface WriteArtifactInput extends PublishArtifactInput {
  content: string;
}

export interface RegisterRunFileInput {
  sessionId: string;
  runId: string;
  runOutboxPath: string;
  relativePath: string;
  title?: string | null;
  description?: string | null;
}

const migrations: readonly SqliteMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sandbox_path TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        preview_kind TEXT NOT NULL,
        text_preview TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS artifacts_session_idx
        ON artifacts(session_id, created_at);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE artifacts ADD COLUMN run_id TEXT;
      CREATE INDEX IF NOT EXISTS artifacts_run_idx
        ON artifacts(session_id, run_id, created_at);
    `,
  },
];

export class SqliteArtifactStore {
  private readonly db: Database;

  constructor(
    dbPath: string,
    private readonly workspaceRoot: string,
    private readonly outboxRoot: string,
  ) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "artifacts", migrations);
  }

  async publish(input: PublishArtifactInput): Promise<ArtifactPublishResult> {
    const normalized = normalizeRunOutboxPath(input.path, input.runOutboxPath);
    return this.createRecord({
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      sandboxPath: normalized.sandboxPath,
      relativePath: normalized.relativePath,
      title: input.title,
      description: input.description,
    });
  }

  async registerRunFile(input: RegisterRunFileInput): Promise<ArtifactPublishResult> {
    const normalized = relativePathForRunFile(input.runOutboxPath, input.relativePath);
    return this.createRecord({
      sessionId: input.sessionId,
      runId: input.runId,
      sandboxPath: normalized.sandboxPath,
      relativePath: normalized.relativePath,
      title: input.title,
      description: input.description,
    });
  }

  async write(input: WriteArtifactInput): Promise<ArtifactPublishResult> {
    const normalized = normalizeRunOutboxPath(input.path, input.runOutboxPath);
    const target = await resolveRunOutboxWriteTarget(this.outboxRoot, normalized.relativePath);
    await Bun.write(target.hostPath, input.content);
    return this.createRecord({
      sessionId: input.sessionId,
      runId: input.runId ?? null,
      sandboxPath: normalized.sandboxPath,
      relativePath: normalized.relativePath,
      title: input.title,
      description: input.description,
    });
  }

  private async createRecord(input: {
    sessionId: string;
    runId: string | null;
    sandboxPath: string;
    relativePath: string;
    title?: string | null;
    description?: string | null;
  }): Promise<ArtifactPublishResult> {
    const resolved = await resolveOutboxFile(this.workspaceRoot, this.outboxRoot, input.sandboxPath, input.relativePath);
    const filename = basename(input.relativePath);
    const mimeType = mimeTypeForPath(filename);
    const preview = await previewForFile(resolved.hostPath, mimeType, resolved.sizeBytes);
    const entry: ArtifactEntry = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      runId: input.runId,
      sandboxPath: input.sandboxPath,
      relativePath: input.relativePath,
      title: input.title?.trim() || filename,
      description: input.description?.trim() || null,
      filename,
      mimeType,
      sizeBytes: resolved.sizeBytes,
      previewKind: preview.previewKind,
      textPreview: preview.textPreview,
      createdAt: new Date().toISOString(),
    };
    this.db.query(`
      INSERT INTO artifacts (
        id, session_id, run_id, sandbox_path, relative_path, title, description,
        filename, mime_type, size_bytes, preview_kind, text_preview, created_at
      ) VALUES (
        $id, $sessionId, $runId, $sandboxPath, $relativePath, $title, $description,
        $filename, $mimeType, $sizeBytes, $previewKind, $textPreview, $createdAt
      )
    `).run(bindArtifact(entry));
    return withUrls(entry);
  }

  get(id: string): ArtifactEntry | null {
    const row = this.db.query("SELECT * FROM artifacts WHERE id = $id").get({ $id: id }) as ArtifactRow | undefined;
    return row ? entryFromRow(row) : null;
  }

  listForSession(sessionId: string): ArtifactEntry[] {
    const rows = this.db.query(`
      SELECT * FROM artifacts
      WHERE session_id = $sessionId
      ORDER BY created_at, id
    `).all({ $sessionId: sessionId }) as ArtifactRow[];
    return rows.map(entryFromRow);
  }

  recentForSession(sessionId: string, limit = 10): ArtifactEntry[] {
    const rows = this.db.query(`
      SELECT * FROM artifacts
      WHERE session_id = $sessionId
      ORDER BY created_at DESC, id DESC
      LIMIT $limit
    `).all({ $sessionId: sessionId, $limit: limit }) as ArtifactRow[];
    return rows.map(entryFromRow);
  }

  recent(limit = 50, sessionId?: string): ArtifactEntry[] {
    const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
    const rows = sessionId
      ? this.db.query(`
          SELECT * FROM artifacts WHERE session_id = $sessionId
          ORDER BY created_at DESC, id DESC LIMIT $limit
        `).all({ $sessionId: sessionId, $limit: bounded })
      : this.db.query(`
          SELECT * FROM artifacts
          ORDER BY created_at DESC, id DESC LIMIT $limit
        `).all({ $limit: bounded });
    return (rows as ArtifactRow[]).map(entryFromRow);
  }

  listForRun(sessionId: string, runId: string): ArtifactEntry[] {
    const rows = this.db.query(`
      SELECT * FROM artifacts
      WHERE session_id = $sessionId AND run_id = $runId
      ORDER BY created_at, id
    `).all({ $sessionId: sessionId, $runId: runId }) as ArtifactRow[];
    return rows.map(entryFromRow);
  }

  findInSession(sessionId: string, query: string, limit = 10): ArtifactEntry[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.recentForSession(sessionId, limit);
    return this.listForSession(sessionId)
      .filter((entry) => artifactMatches(entry, needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit);
  }

  outboxRootPath(): string {
    return this.outboxRoot;
  }

  delete(id: string): boolean {
    const result = this.db.query("DELETE FROM artifacts WHERE id = $id").run({ $id: id });
    return result.changes > 0;
  }

  async deleteForSessions(sessionIds: readonly string[], options: { deleteFiles?: boolean } = {}): Promise<number> {
    const ids = [...new Set(sessionIds.filter(Boolean))];
    if (ids.length === 0) return 0;
    const placeholders = ids.map((_, i) => `$id${i}`).join(", ");
    const params = Object.fromEntries(ids.map((id, i) => [`$id${i}`, id]));
    const rows = this.db.query(`
      SELECT * FROM artifacts
      WHERE session_id IN (${placeholders})
    `).all(params) as ArtifactRow[];
    const entries = rows.map(entryFromRow);
    if (options.deleteFiles) {
      for (const entry of entries) await this.deleteManagedFile(entry);
    }
    const result = this.db.query(`
      DELETE FROM artifacts
      WHERE session_id IN (${placeholders})
    `).run(params);
    return result.changes;
  }

  async resolveFile(id: string): Promise<{ entry: ArtifactEntry; hostPath: string; sizeBytes: number } | null> {
    const entry = this.get(id);
    if (!entry) return null;
    const resolved = await resolveOutboxFile(this.workspaceRoot, this.outboxRoot, entry.sandboxPath, entry.relativePath);
    return { entry, ...resolved };
  }

  close(): void {
    this.db.close();
  }

  private async deleteManagedFile(entry: ArtifactEntry): Promise<void> {
    if (!entry.sandboxPath.startsWith("/outbox/")) return;
    let hostPath: string;
    try {
      hostPath = safeJoin(this.outboxRoot, entry.relativePath);
      const info = await lstat(hostPath);
      if (!info.isFile() || info.isSymbolicLink()) return;
      await unlink(hostPath);
    } catch {
      return;
    }
    await pruneEmptyParents(path.dirname(hostPath), this.outboxRoot);
  }
}

export function artifactResultToMessage(value: unknown): ArtifactPublishResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.sandboxPath !== "string") return null;
  if (typeof item.openUrl !== "string" || typeof item.downloadUrl !== "string") return null;
  const previewKind = item.previewKind;
  if (previewKind !== "text" && previewKind !== "image" && previewKind !== "download") return null;
  return {
    id: item.id,
    sessionId: stringField(item.sessionId),
    runId: nullableString(item.runId),
    sandboxPath: item.sandboxPath,
    relativePath: stringField(item.relativePath),
    title: stringField(item.title) || stringField(item.filename) || "Artifact",
    description: nullableString(item.description),
    filename: stringField(item.filename),
    mimeType: stringField(item.mimeType) || "application/octet-stream",
    sizeBytes: numberField(item.sizeBytes),
    previewKind,
    textPreview: nullableString(item.textPreview),
    createdAt: stringField(item.createdAt) || new Date().toISOString(),
    openUrl: item.openUrl,
    downloadUrl: item.downloadUrl,
  };
}

function withUrls(entry: ArtifactEntry): ArtifactPublishResult {
  return {
    ...entry,
    openUrl: `/api/artifacts/${entry.id}`,
    downloadUrl: `/api/artifacts/${entry.id}?download=1`,
  };
}

function bindArtifact(entry: ArtifactEntry) {
  return {
    $id: entry.id,
    $sessionId: entry.sessionId,
    $runId: entry.runId,
    $sandboxPath: entry.sandboxPath,
    $relativePath: entry.relativePath,
    $title: entry.title,
    $description: entry.description,
    $filename: entry.filename,
    $mimeType: entry.mimeType,
    $sizeBytes: entry.sizeBytes,
    $previewKind: entry.previewKind,
    $textPreview: entry.textPreview,
    $createdAt: entry.createdAt,
  };
}

function entryFromRow(row: ArtifactRow): ArtifactEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    sandboxPath: row.sandbox_path,
    relativePath: row.relative_path,
    title: row.title,
    description: row.description,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    previewKind: row.preview_kind,
    textPreview: row.text_preview,
    createdAt: row.created_at,
  };
}

function artifactMatches(entry: ArtifactEntry, needle: string): boolean {
  const haystack = [
    entry.id,
    entry.title,
    entry.description ?? "",
    entry.filename,
    entry.sandboxPath,
    entry.relativePath,
  ].join("\n").toLowerCase();
  return haystack.includes(needle);
}

async function pruneEmptyParents(start: string, root: string): Promise<void> {
  let dir = path.resolve(start);
  const resolvedRoot = path.resolve(root);
  while (dir !== resolvedRoot) {
    const rel = path.relative(resolvedRoot, dir);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return;
    try {
      await rmdir(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
