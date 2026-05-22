import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import {
  type MeshPeerRecord,
  type MeshServiceDescriptor,
  type MeshSharingSettings,
  type MeshTransport,
  type MeshTrustLevel,
} from "./types";

interface PeerRow {
  peer_id: string;
  name: string;
  host: string | null;
  port: number | null;
  public_key_jwk: string;
  fingerprint: string;
  certificate_pem: string | null;
  certificate_fingerprint: string | null;
  supports_http3: number | null;
  last_transport: MeshTransport | null;
  last_transport_error_at: string | null;
  trust_level: MeshTrustLevel;
  remote_trust_level: MeshTrustLevel;
  status: "online" | "offline";
  last_seen_at: string | null;
  last_health_at: string | null;
  latency_ms: number | null;
  service_catalog_json: string;
  revoked: number;
  created_at: string;
  updated_at: string;
}

interface SettingRow {
  value: string;
}

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS mesh_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mesh_peers (
        peer_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT,
        port INTEGER,
        public_key_jwk TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        trust_level TEXT NOT NULL DEFAULT 'acquaintance',
        remote_trust_level TEXT NOT NULL DEFAULT 'acquaintance',
        status TEXT NOT NULL DEFAULT 'offline',
        last_seen_at TEXT,
        last_health_at TEXT,
        latency_ms INTEGER,
        service_catalog_json TEXT NOT NULL DEFAULT '[]',
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS mesh_nonces (
        peer_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (peer_id, nonce)
      );
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE mesh_peers ADD COLUMN certificate_pem TEXT;
      ALTER TABLE mesh_peers ADD COLUMN certificate_fingerprint TEXT;
      ALTER TABLE mesh_peers ADD COLUMN supports_http3 INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE mesh_peers ADD COLUMN last_transport TEXT;
      ALTER TABLE mesh_peers ADD COLUMN last_transport_error_at TEXT;
      UPDATE mesh_peers SET status = 'offline', service_catalog_json = '[]' WHERE certificate_pem IS NULL;
    `,
  },
];

export class SqliteMeshStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA busy_timeout = 10000;");
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    applySqliteMigrations(this.db, "mesh", migrations);
  }

  loadSetting<T>(key: string): T | null {
    const row = this.db.query("SELECT value FROM mesh_settings WHERE key = $key").get({ $key: key }) as
      | SettingRow
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  saveSetting<T>(key: string, value: T): void {
    this.db.query(`
      INSERT INTO mesh_settings (key, value, updated_at)
      VALUES ($key, $value, $updatedAt)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run({
      $key: key,
      $value: JSON.stringify(value),
      $updatedAt: new Date().toISOString(),
    });
  }

  deleteSetting(key: string): void {
    this.db.query("DELETE FROM mesh_settings WHERE key = $key").run({ $key: key });
  }

  meshEnabled(): boolean {
    return this.loadSetting<{ enabled?: boolean }>("enabled")?.enabled !== false;
  }

  saveMeshEnabled(enabled: boolean): boolean {
    this.saveSetting("enabled", { enabled });
    return enabled;
  }

  sharing(): MeshSharingSettings {
    return {
      inference: true,
      search: true,
      ...this.loadSetting<Partial<MeshSharingSettings>>("sharing"),
    };
  }

  saveSharing(patch: Partial<MeshSharingSettings>): MeshSharingSettings {
    const next = { ...this.sharing(), ...patch };
    this.saveSetting("sharing", next);
    return next;
  }

  preferredPort(): number | null {
    const value = this.loadSetting<{ port?: number }>("port")?.port;
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  }

  savePreferredPort(port: number): void {
    this.saveSetting("port", { port });
  }

  proxyPort(): number | null {
    const value = this.loadSetting<{ port?: number }>("proxy-port")?.port;
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  }

  saveProxyPort(port: number): void {
    this.saveSetting("proxy-port", { port });
  }

  upsertPairedPeer(input: {
    peerId: string;
    name: string;
    host?: string | null;
    port?: number | null;
    certificatePem: string;
    fingerprint: string;
    supportsHttp3: boolean;
  }): MeshPeerRecord {
    const now = new Date().toISOString();
    this.db.query(`
      INSERT INTO mesh_peers (
        peer_id, name, host, port, public_key_jwk, fingerprint, certificate_pem,
        certificate_fingerprint, supports_http3, trust_level, remote_trust_level, status, last_seen_at, service_catalog_json,
        revoked, created_at, updated_at
      )
      VALUES (
        $peerId, $name, $host, $port, '{}', $fingerprint, $certificatePem,
        $fingerprint, $supportsHttp3, 'acquaintance', 'acquaintance', 'online', $now, '[]', 0, $now, $now
      )
      ON CONFLICT(peer_id) DO UPDATE SET
        name = excluded.name,
        host = COALESCE(excluded.host, mesh_peers.host),
        port = COALESCE(excluded.port, mesh_peers.port),
        fingerprint = excluded.fingerprint,
        certificate_pem = excluded.certificate_pem,
        certificate_fingerprint = excluded.certificate_fingerprint,
        supports_http3 = excluded.supports_http3,
        last_transport = NULL,
        last_transport_error_at = NULL,
        trust_level = 'acquaintance',
        remote_trust_level = 'acquaintance',
        status = 'online',
        last_seen_at = $now,
        service_catalog_json = '[]',
        revoked = 0,
        updated_at = $now
    `).run({
      $peerId: input.peerId,
      $name: input.name,
      $host: input.host ?? null,
      $port: input.port ?? null,
      $certificatePem: input.certificatePem,
      $fingerprint: input.fingerprint,
      $supportsHttp3: input.supportsHttp3 ? 1 : 0,
      $now: now,
    });
    return this.requirePeer(input.peerId);
  }

  updatePresence(peerId: string, input: {
    host?: string | null;
    port?: number | null;
    status: "online" | "offline";
    latencyMs?: number | null;
    remoteTrustLevel?: MeshTrustLevel;
    serviceCatalog?: MeshServiceDescriptor[];
    lastTransport?: MeshTransport | null;
    lastTransportErrorAt?: string | null;
    supportsHttp3?: boolean;
  }): MeshPeerRecord | null {
    const current = this.peer(peerId);
    if (!current) return null;
    const now = new Date().toISOString();
    const hasTransportError = Object.prototype.hasOwnProperty.call(input, "lastTransportErrorAt");
    this.db.query(`
      UPDATE mesh_peers SET
        host = $host,
        port = $port,
        status = $status,
        last_seen_at = CASE WHEN $status = 'online' THEN $now ELSE last_seen_at END,
        last_health_at = $now,
        latency_ms = $latencyMs,
        last_transport = $lastTransport,
        last_transport_error_at = $lastTransportErrorAt,
        supports_http3 = $supportsHttp3,
        remote_trust_level = $remoteTrustLevel,
        service_catalog_json = $catalog,
        updated_at = $now
      WHERE peer_id = $peerId
    `).run({
      $peerId: peerId,
      $host: input.host ?? current.host,
      $port: input.port ?? current.port,
      $status: input.status,
      $latencyMs: input.latencyMs ?? null,
      $lastTransport: input.lastTransport ?? current.lastTransport,
      $lastTransportErrorAt: hasTransportError ? input.lastTransportErrorAt ?? null : current.lastTransportErrorAt,
      $supportsHttp3: (input.supportsHttp3 ?? current.supportsHttp3) ? 1 : 0,
      $remoteTrustLevel: input.remoteTrustLevel ?? current.remoteTrustLevel,
      $catalog: "[]",
      $now: now,
    });
    return this.peer(peerId);
  }

  setTrustLevel(peerId: string, trustLevel: MeshTrustLevel): MeshPeerRecord {
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE mesh_peers SET trust_level = $trustLevel, updated_at = $now
      WHERE peer_id = $peerId
    `).run({ $peerId: peerId, $trustLevel: trustLevel, $now: now });
    return this.requirePeer(peerId);
  }

  revokePeer(peerId: string): MeshPeerRecord {
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE mesh_peers SET revoked = 1, status = 'offline', service_catalog_json = '[]', updated_at = $now
      WHERE peer_id = $peerId
    `).run({ $peerId: peerId, $now: now });
    return this.requirePeer(peerId);
  }

  unpairPeer(peerId: string): void {
    this.db.query("DELETE FROM mesh_peers WHERE peer_id = $peerId").run({ $peerId: peerId });
    this.db.query("DELETE FROM mesh_nonces WHERE peer_id = $peerId").run({ $peerId: peerId });
  }

  unpairAll(): void {
    this.db.exec("DELETE FROM mesh_peers; DELETE FROM mesh_nonces;");
  }

  markAllOffline(): void {
    const now = new Date().toISOString();
    this.db.query(`
      UPDATE mesh_peers SET
        status = 'offline',
        latency_ms = NULL,
        service_catalog_json = '[]',
        updated_at = $now
      WHERE status != 'offline' OR latency_ms IS NOT NULL OR service_catalog_json != '[]'
    `).run({ $now: now });
  }

  peer(peerId: string): MeshPeerRecord | null {
    const row = this.db.query("SELECT * FROM mesh_peers WHERE peer_id = $peerId").get({ $peerId: peerId }) as
      | PeerRow
      | undefined;
    return row ? peerFromRow(row) : null;
  }

  requirePeer(peerId: string): MeshPeerRecord {
    const peer = this.peer(peerId);
    if (!peer) throw new Error(`Mesh peer not found: ${peerId}`);
    return peer;
  }

  peers(): MeshPeerRecord[] {
    const rows = this.db.query("SELECT * FROM mesh_peers ORDER BY name COLLATE NOCASE").all() as PeerRow[];
    return rows.map(peerFromRow);
  }

  markNonce(peerId: string, nonce: string, timestamp: number): boolean {
    this.pruneNonces(Date.now() - 10 * 60_000);
    try {
      this.db.query("INSERT INTO mesh_nonces (peer_id, nonce, seen_at) VALUES ($peerId, $nonce, $seenAt)").run({
        $peerId: peerId,
        $nonce: nonce,
        $seenAt: timestamp,
      });
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.db.close();
  }

  private pruneNonces(cutoff: number): void {
    this.db.query("DELETE FROM mesh_nonces WHERE seen_at < $cutoff").run({ $cutoff: cutoff });
  }
}

function peerFromRow(row: PeerRow): MeshPeerRecord {
  return {
    peerId: row.peer_id,
    name: row.name,
    host: row.host,
    port: row.port,
    fingerprint: row.certificate_fingerprint || row.fingerprint,
    certificatePem: row.certificate_pem,
    supportsHttp3: row.supports_http3 === 1,
    lastTransport: normalizeTransport(row.last_transport),
    lastTransportErrorAt: row.last_transport_error_at,
    trustLevel: normalizeTrust(row.trust_level),
    remoteTrustLevel: normalizeTrust(row.remote_trust_level),
    status: row.status === "online" ? "online" : "offline",
    lastSeenAt: row.last_seen_at,
    lastHealthAt: row.last_health_at,
    latencyMs: row.latency_ms,
    serviceCatalog: [],
    revoked: row.revoked === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeTransport(value: string | null): MeshTransport | null {
  return value === "http3" || value === "http2" || value === "http1.1" ? value : null;
}

function normalizeTrust(value: string): MeshTrustLevel {
  if (value === "friend" || value === "family") return value;
  return "acquaintance";
}
