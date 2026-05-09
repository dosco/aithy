import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SqliteSoulStore } from "../src/soul/sqlite-soul-store";
import type { SoulFields } from "../src/soul/types";

describe("SqliteSoulStore", () => {
  test("returns undefined when nothing is stored", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteSoulStore(dbPath);
    expect(store.loadSoulProfile()).toBeUndefined();
  });

  test("saves and loads soul fields and renders responderDescription", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteSoulStore(dbPath);
    const fields: SoulFields = {
      name: "aithy",
      description: "A friendly helper.",
      coreNature: "Curious and patient.",
      communicationStyle: "Concise and warm.",
      behaviour: "Helps efficiently.",
      negativeBehavior: "Avoids verbosity.",
    };
    const saved = store.saveSoulProfile(fields);

    expect(saved.name).toBe("aithy");
    expect(saved.responderDescription).toContain("## Core Nature");
    expect(saved.responderDescription).toContain("Curious and patient.");
    expect(saved.responderDescription).toContain("## What to Avoid");

    const loaded = store.loadSoulProfile();
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe("aithy");
    expect(loaded!.coreNature).toBe("Curious and patient.");
    expect(loaded!.responderDescription).toBe(saved.responderDescription);

    const rows = new Database(dbPath, { readonly: true })
      .query("SELECT key FROM metadata ORDER BY key")
      .all() as Array<{ key: string }>;
    expect(rows.map((r) => r.key)).toEqual([
      "bot.behaviour",
      "bot.communicationStyle",
      "bot.coreNature",
      "bot.description",
      "bot.name",
      "bot.negativeBehavior",
      "bot.updatedAt",
    ]);
  });

  test("overwrites existing fields on subsequent save", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteSoulStore(dbPath);
    store.saveSoulProfile({
      name: "aithy",
      description: "first",
      coreNature: "first",
      communicationStyle: "first",
      behaviour: "first",
      negativeBehavior: "first",
    });
    const next = store.saveSoulProfile({
      name: "aithy2",
      description: "second",
      coreNature: "second core",
      communicationStyle: "second style",
      behaviour: "second beh",
      negativeBehavior: "second neg",
    });
    expect(next.name).toBe("aithy2");
    expect(next.coreNature).toBe("second core");
    expect(store.loadSoulProfile()?.description).toBe("second");
  });
});

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-soul-db-"));
  return path.join(dir, "state.db");
}
