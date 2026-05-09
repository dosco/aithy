import type { Database } from "bun:sqlite";

export interface SqliteMigration {
  version: number;
  sql: string;
  precondition?: (db: Database) => boolean;
}

export function applySqliteMigrations(
  db: Database,
  scope: string,
  migrations: readonly SqliteMigration[],
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      scope TEXT NOT NULL,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (scope, version)
    );
  `);

  const appliedRows = db.query(`
    SELECT version
    FROM schema_migrations
    WHERE scope = $scope
  `).all({ $scope: scope }) as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((row) => row.version));

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    if (migration.precondition && !migration.precondition(db)) continue;
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(migration.sql);
      db.query(`
        INSERT INTO schema_migrations (scope, version, applied_at)
        VALUES ($scope, $version, $appliedAt)
      `).run({
        $scope: scope,
        $version: migration.version,
        $appliedAt: new Date().toISOString(),
      });
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
}
