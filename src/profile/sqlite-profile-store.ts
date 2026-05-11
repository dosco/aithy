import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applySqliteMigrations } from "../sqlite/migrations";
import type {
  ProfileImage,
  ProfileImageKind,
  ProfileStore,
  StoredProfileImage,
  UserProfile,
  UserProfileFields,
} from "./types";

interface MetadataRow {
  key: string;
  value: string;
}

interface ImageRow {
  kind: ProfileImageKind;
  mime_type: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  updated_at: string;
}

const profileMigrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        hash TEXT
      );
      CREATE TABLE IF NOT EXISTS profile_images (
        kind TEXT PRIMARY KEY CHECK (kind IN ('user', 'agent')),
        mime_type TEXT NOT NULL,
        bytes BLOB NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
];

const userNameKey = "user.name";
const userLocationKey = "user.location";
const updatedAtKey = "user.updatedAt";

export class SqliteProfileStore implements ProfileStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    applySqliteMigrations(this.db, "profile", profileMigrations);
  }

  loadProfile(): UserProfile | undefined {
    const rows = this.db
      .query("SELECT key, value FROM metadata WHERE key IN ($name, $location, $updatedAt)")
      .all({ $name: userNameKey, $location: userLocationKey, $updatedAt: updatedAtKey }) as MetadataRow[];
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const userName = byKey.get(userNameKey)?.trim() ?? "";
    if (!userName) return undefined;
    return this.withImages({
      userName,
      userLocation: byKey.get(userLocationKey) ?? "",
      updatedAt: byKey.get(updatedAtKey) ?? new Date().toISOString(),
    });
  }

  saveProfile(fields: UserProfileFields): UserProfile {
    const trimmed: UserProfileFields = {
      userName: fields.userName.trim(),
      userLocation: fields.userLocation.trim(),
    };
    if (!trimmed.userName) throw new Error("User name is required");
    const updatedAt = new Date().toISOString();
    const upsert = this.db.query(`
      INSERT INTO metadata (key, value, hash)
      VALUES ($key, $value, NULL)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, hash = NULL
    `);
    const tx = this.db.transaction(() => {
      upsert.run({ $key: userNameKey, $value: trimmed.userName });
      upsert.run({ $key: userLocationKey, $value: trimmed.userLocation });
      upsert.run({ $key: updatedAtKey, $value: updatedAt });
    });
    tx();
    return this.withImages({ ...trimmed, updatedAt });
  }

  saveImage(kind: ProfileImageKind, image: StoredProfileImage): UserProfile {
    const updatedAt = new Date().toISOString();
    this.db.query(`
      INSERT INTO profile_images (kind, mime_type, bytes, width, height, updated_at)
      VALUES ($kind, $mimeType, $bytes, $width, $height, $updatedAt)
      ON CONFLICT(kind) DO UPDATE SET
        mime_type = excluded.mime_type,
        bytes = excluded.bytes,
        width = excluded.width,
        height = excluded.height,
        updated_at = excluded.updated_at
    `).run({
      $kind: kind,
      $mimeType: image.mimeType,
      $bytes: image.bytes,
      $width: image.width,
      $height: image.height,
      $updatedAt: updatedAt,
    });
    const profile = this.loadProfile();
    if (!profile) throw new Error("Save a user name before adding profile photos.");
    return profile;
  }

  clearImage(kind: ProfileImageKind): UserProfile {
    this.db.query("DELETE FROM profile_images WHERE kind = $kind").run({ $kind: kind });
    const profile = this.loadProfile();
    if (!profile) throw new Error("Save a user name before changing profile photos.");
    return profile;
  }

  close(): void {
    this.db.close();
  }

  private withImages(profile: Omit<UserProfile, "userPhoto" | "agentPhoto">): UserProfile {
    const images = this.db
      .query("SELECT kind, mime_type, bytes, width, height, updated_at FROM profile_images")
      .all() as ImageRow[];
    const out: UserProfile = { ...profile };
    for (const row of images) {
      const image: ProfileImage = {
        kind: row.kind,
        mimeType: row.mime_type,
        bytes: row.bytes,
        width: row.width,
        height: row.height,
        updatedAt: row.updated_at,
      };
      if (row.kind === "user") out.userPhoto = image;
      if (row.kind === "agent") out.agentPhoto = image;
    }
    return out;
  }
}
