import type { Database } from "bun:sqlite";

interface SandboxFileMountRow {
  source_path: string;
  sandbox_path: string;
  workspace_path: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface SandboxFileMountRecord {
  sourcePath: string;
  sandboxPath: string;
  workspacePath: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSandboxFileMountInput {
  sourcePath: string;
  sandboxPath: string;
  workspacePath: string;
  sizeBytes: number;
}

export function upsertSandboxFileMount(db: Database, input: UpsertSandboxFileMountInput): SandboxFileMountRecord {
  const now = new Date().toISOString();
  db.query(`
    INSERT INTO sandbox_file_mounts (
      source_path, sandbox_path, workspace_path, size_bytes, created_at, updated_at
    ) VALUES (
      $sourcePath, $sandboxPath, $workspacePath, $sizeBytes, $now, $now
    )
    ON CONFLICT(source_path) DO UPDATE SET
      sandbox_path = excluded.sandbox_path,
      workspace_path = excluded.workspace_path,
      size_bytes = excluded.size_bytes,
      updated_at = excluded.updated_at
  `).run({
    $sourcePath: input.sourcePath,
    $sandboxPath: input.sandboxPath,
    $workspacePath: input.workspacePath,
    $sizeBytes: input.sizeBytes,
    $now: now,
  });
  return sandboxFileMount(db, input.sourcePath)!;
}

export function sandboxFileMount(db: Database, sourcePath: string): SandboxFileMountRecord | null {
  const row = db.query(`
    SELECT * FROM sandbox_file_mounts
    WHERE source_path = $sourcePath
  `).get({ $sourcePath: sourcePath }) as SandboxFileMountRow | undefined;
  return row ? recordFromRow(row) : null;
}

function recordFromRow(row: SandboxFileMountRow): SandboxFileMountRecord {
  return {
    sourcePath: row.source_path,
    sandboxPath: row.sandbox_path,
    workspacePath: row.workspace_path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
