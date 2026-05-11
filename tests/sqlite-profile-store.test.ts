import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SqliteProfileStore } from "../src/profile/sqlite-profile-store";

describe("SqliteProfileStore", () => {
  test("returns undefined when the required user name is missing", async () => {
    const store = new SqliteProfileStore(await tempDbPath());
    expect(store.loadProfile()).toBeUndefined();
  });

  test("saves and loads user profile fields", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteProfileStore(dbPath);
    const saved = store.saveProfile({
      userName: "Violet",
      userLocation: "Vancouver",
    });

    expect(saved.userName).toBe("Violet");
    expect(saved.userLocation).toBe("Vancouver");
    expect(store.loadProfile()).toMatchObject({
      userName: "Violet",
      userLocation: "Vancouver",
    });

    const rows = new Database(dbPath, { readonly: true })
      .query("SELECT key FROM metadata WHERE key LIKE 'user.%' ORDER BY key")
      .all() as Array<{ key: string }>;
    expect(rows.map((row) => row.key)).toEqual([
      "user.location",
      "user.name",
      "user.updatedAt",
    ]);
  });

  test("stores user and agent images in profile_images", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteProfileStore(dbPath);
    store.saveProfile({ userName: "Violet", userLocation: "" });
    store.saveImage("user", imageFixture([1, 2, 3]));
    store.saveImage("agent", imageFixture([4, 5, 6]));

    const loaded = store.loadProfile();
    expect(loaded?.userPhoto?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(loaded?.agentPhoto?.bytes).toEqual(new Uint8Array([4, 5, 6]));

    const count = new Database(dbPath, { readonly: true })
      .query("SELECT COUNT(*) AS c FROM profile_images")
      .get() as { c: number };
    expect(count.c).toBe(2);
  });

  test("clears a stored image", async () => {
    const store = new SqliteProfileStore(await tempDbPath());
    store.saveProfile({ userName: "Violet", userLocation: "" });
    store.saveImage("user", imageFixture([1]));
    store.clearImage("user");
    expect(store.loadProfile()?.userPhoto).toBeUndefined();
  });
});

function imageFixture(bytes: number[]) {
  return {
    mimeType: "image/webp",
    bytes: new Uint8Array(bytes),
    width: 256,
    height: 256,
  };
}

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-profile-db-"));
  return path.join(dir, "state.db");
}
