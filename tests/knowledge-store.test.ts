import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { SqliteKnowledgeStore } from "../src/knowledge/knowledge-store";

async function tempDbPath(): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), "aithy-knowledge-")), "state.db");
}

const okfFiles = [
  { path: "sales/index.md", content: '---\nokf_version: "0.1"\n---\n# Sales Knowledge\n' },
  { path: "sales/tables/orders.md", content: `---
type: BigQuery Table
title: Orders
description: Completed orders.
tags: [sales, revenue]
owner: analytics
---
# Schema

One row per order. See [customers](./customers.md).

# Citations

[BigQuery](https://cloud.google.com/bigquery)
` },
  { path: "sales/tables/customers.md", content: `---
type: BigQuery Table
title: Customers
---
Customer records. See [orders](/tables/orders.md).
` },
  { path: "sales/log.md", content: "# Directory Update Log\n\n## 2026-07-14\n* **Creation**: Created bundle.\n" },
];

describe("SqliteKnowledgeStore", () => {
  test("uses additive scoped migrations and cascades bundle data", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteKnowledgeStore(dbPath);
    const bundle = store.createBundle({ name: "Runbooks" });
    expect(store.updateBundle(bundle.id, { name: "Operations", description: "Reviewed procedures." })).toEqual(
      expect.objectContaining({ name: "Operations", description: "Reviewed procedures.", source: "manual" }),
    );
    store.upsertConcept(bundle.id, { path: "alerts/freshness.md", type: "Playbook", title: "Freshness", body: "Check the pipeline." });
    expect(store.documents(bundle.id)).toHaveLength(1);
    expect(store.deleteBundle(bundle.id)).toBe(true);
    expect(store.documents()).toHaveLength(0);
    store.close();

    const db = new Database(dbPath);
    const migration = db.query("SELECT version FROM schema_migrations WHERE scope='knowledge' ORDER BY version").all();
    expect(migration.length).toBeGreaterThanOrEqual(1);
    db.close();
  });

  test("previews and atomically imports OKF with links, warnings, and unknown frontmatter", async () => {
    const store = new SqliteKnowledgeStore(await tempDbPath());
    const preview = store.previewOkf(okfFiles);
    expect(preview.invalid).toEqual([]);
    expect(preview.name).toBe("Sales Knowledge");
    expect(preview.added).toHaveLength(4);
    expect(preview.brokenLinks).toEqual([]);
    const bundle = store.importOkf(preview);
    expect(() => store.updateBundle(bundle.id, { name: "Renamed" })).toThrow("root index.md");
    const orders = store.search("completed orders", { bundleId: bundle.id })[0];
    expect(orders.title).toBe("Orders");
    const read = store.read(orders.id)!;
    expect(read.frontmatter.owner).toBe("analytics");
    expect(read.links.some((link) => link.kind === "internal")).toBe(true);
    expect(read.citations.some((link) => link.kind === "citation")).toBe(true);
    expect(read.backlinks.some((link) => link.sourceTitle === "Customers")).toBe(true);
    store.close();
  });

  test("requires confirmation before snapshot deletion and keeps the prior snapshot", async () => {
    const store = new SqliteKnowledgeStore(await tempDbPath());
    const bundle = store.importOkf(store.previewOkf(okfFiles));
    const nextFiles = okfFiles.filter((file) => !file.path.endsWith("customers.md"));
    const preview = store.previewOkf(nextFiles, bundle.id);
    expect(preview.removed).toEqual(["tables/customers.md"]);
    expect(() => store.importOkf(preview, { bundleId: bundle.id })).toThrow("Confirm removal");
    expect(store.documents(bundle.id).some((doc) => doc.path === "tables/customers.md")).toBe(true);
    store.importOkf(preview, { bundleId: bundle.id, confirmRemoved: true });
    expect(store.documents(bundle.id).some((doc) => doc.path === "tables/customers.md")).toBe(false);
    store.close();
  });

  test("filters disabled bundles and counts only normal retrievals", async () => {
    const store = new SqliteKnowledgeStore(await tempDbPath());
    const bundle = store.createBundle({ name: "Product" });
    const document = store.upsertConcept(bundle.id, { path: "pricing.md", type: "Policy", title: "Pricing", tags: ["sales"], body: "Enterprise pricing requires review." });
    expect(store.search("enterprise", { tags: ["sales"] })).toHaveLength(1);
    expect(store.getDocument(document.id)?.retrievedCount).toBe(1);
    store.read(document.id, { increment: false });
    expect(store.getDocument(document.id)?.retrievedCount).toBe(1);
    store.setBundleEnabled(bundle.id, false);
    expect(store.search("enterprise")).toEqual([]);
    store.close();
  });

  test("reads a bounded section and exposes truncation", async () => {
    const store = new SqliteKnowledgeStore(await tempDbPath());
    const bundle = store.createBundle({ name: "Engineering" });
    const document = store.upsertConcept(bundle.id, { path: "deploy.md", type: "Runbook", title: "Deploy", body: `# Prepare\n\nValidate.\n\n# Execute\n\n${"ship ".repeat(9_000)}\n\n# Verify\n\nObserve.` });
    const section = store.read(document.id, { section: "Execute" })!;
    expect(section.body.startsWith("# Execute")).toBe(true);
    expect(section.body).not.toContain("# Verify");
    expect(section.truncated).toBe(true);
    const full = store.read(document.id, { increment: false, maxBytes: 1_048_576 })!;
    expect(full.body).toContain("# Verify");
    expect(full.truncated).toBe(false);
    expect(store.read(document.id, { section: "Missing" })).toBeNull();
    store.close();
  });

  test("proposals never write directly and stale updates cannot be accepted", async () => {
    const store = new SqliteKnowledgeStore(await tempDbPath());
    const bundle = store.createBundle({ name: "Operations" });
    const original = store.upsertConcept(bundle.id, { path: "oncall.md", type: "Runbook", title: "On-call", body: "Page primary." });
    const proposal = store.propose({ bundleId: bundle.id, operation: "update", conceptId: "oncall",
      fields: { path: "oncall.md", type: "Runbook", title: "On-call", body: "Page primary then secondary." },
      rationale: "Clarifies escalation.", evidence: ["incident-42"] });
    expect(store.getDocument(original.id)?.body).toBe("Page primary.");
    store.upsertConcept(bundle.id, { id: original.id, path: "oncall.md", type: "Runbook", title: "On-call", body: "Page incident commander." });
    expect(store.acceptProposal(proposal.id).status).toBe("stale");
    expect(store.getDocument(original.id)?.body).toBe("Page incident commander.");

    const create = store.propose({ bundleId: bundle.id, operation: "create", conceptId: "recovery",
      fields: { path: "recovery.md", type: "Runbook", title: "Recovery", body: "Restore service." },
      rationale: "Missing recovery guide.", evidence: ["postmortem-7"] });
    expect(store.acceptProposal(create.id).status).toBe("accepted");
    expect(store.search("restore service")[0].title).toBe("Recovery");
    store.close();
  });

  test("exports a gzip tarball that re-imports equivalently", async () => {
    const store = new SqliteKnowledgeStore(await tempDbPath());
    const bundle = store.importOkf(store.previewOkf(okfFiles));
    const exported = await store.exportOkf(bundle.id);
    expect(exported.filename).toBe("sales-okf.tar.gz");
    const archive = new Bun.Archive(exported.bytes);
    const files = await archive.files();
    const inputs = await Promise.all([...files.entries()].map(async ([filePath, file]) => ({ path: filePath, content: await file.text() })));
    const roundTrip = store.previewOkf(inputs);
    expect(roundTrip.invalid).toEqual([]);
    expect(roundTrip.files.map((file) => file.path).sort()).toEqual(store.documents(bundle.id).map((doc) => doc.path).sort());
    expect(roundTrip.files.find((doc) => doc.path === "tables/orders.md")?.frontmatter.owner).toBe("analytics");
    store.close();
  });

  test("rejects unsafe paths, malformed frontmatter, reserved files, and size limits", async () => {
    const store = new SqliteKnowledgeStore(await tempDbPath());
    expect(() => store.previewOkf([{ path: "../x.md", content: "---\ntype: X\n---\n" }])).toThrow("traverse");
    const malformed = store.previewOkf([{ path: "bundle/x.md", content: "---\ntype: [\n---\n" }]);
    expect(malformed.invalid).toHaveLength(1);
    const reserved = store.previewOkf([{ path: "bundle/nested/index.md", content: "---\ntype: X\n---\n# X" }]);
    expect(reserved.invalid[0].error).toContain("bundle-root");
    expect(() => store.previewOkf([{ path: "bundle/x.md", content: "x".repeat(1_048_577) }])).toThrow("1 MiB");
    store.close();
  });

  test("reset removes all knowledge and close is safe", async () => {
    const store = new SqliteKnowledgeStore(await tempDbPath());
    const bundle = store.createBundle({ name: "Temporary" });
    store.upsertConcept(bundle.id, { path: "x.md", type: "Note", title: "X", body: "Y" });
    store.resetAll();
    expect(store.bundles()).toEqual([]);
    store.close();
  });
});
