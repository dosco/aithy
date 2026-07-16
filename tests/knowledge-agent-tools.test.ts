import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createAgentTools } from "../src/agent/tools";
import { knowledgeContextText, preloadKnowledge } from "../src/agent/knowledge-context";
import { loadConfig } from "../src/config/env";
import { SqliteKnowledgeStore } from "../src/knowledge/knowledge-store";
import { RuntimeStore } from "../src/runtime/runtime-store";
import { CapabilityBroker } from "../src/security/capability-broker";

describe("knowledge agent integration", () => {
  test("registers bounded reads and audits review-only proposals", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-knowledge-tools-"));
    const dbPath = path.join(root, "state.db");
    const knowledge = new SqliteKnowledgeStore(dbPath);
    const bundle = knowledge.createBundle({ name: "Operations" });
    const concept = knowledge.upsertConcept(bundle.id, { path: "deploy.md", type: "Runbook", title: "Deploy", body: "Validate, deploy, verify." });
    const runtimeStore = new RuntimeStore(dbPath);
    const broker = new CapabilityBroker(runtimeStore);
    broker.ensureDefaultLocalGrants();
    const notifications: unknown[] = [];
    const tools = createAgentTools({
      session: { conversationId: "session-1" }, knowledge, capabilities: broker,
      notify: (input: unknown) => { notifications.push(input); },
    } as any, { ...loadConfig(), sandboxProvider: "disabled" }) as any[];
    const find = (name: string) => tools.find((tool) => `${tool.namespace}.${tool.name}` === name);

    const search = await find("knowledge.search").func({ query: "deploy", limit: 99 });
    expect(search.results).toHaveLength(1);
    const read = await find("knowledge.read").func({ id: concept.id });
    expect(read.concept.body).toContain("verify");
    const listed = await find("knowledge.list").func({ bundleId: bundle.id, limit: 500 });
    expect(listed.documents).toHaveLength(1);
    const huge = knowledge.upsertConcept(bundle.id, {
      path: "large.md", type: "Reference", title: "Large reference", description: "metadata ".repeat(400),
      body: `# Large\n\n${"evidence line\n".repeat(8_000)}`,
    });
    const boundedRead = await find("knowledge.read").func({ id: huge.id });
    expect(new TextEncoder().encode(JSON.stringify(boundedRead)).byteLength).toBeLessThanOrEqual(32_768);
    expect(boundedRead.concept.truncated).toBe(true);
    for (let index = 0; index < 100; index += 1) knowledge.upsertConcept(bundle.id, {
      path: `catalog/item-${index}.md`, type: "Reference", title: `Item ${index}`,
      description: "bounded navigation metadata ".repeat(120), body: "Reference body.",
    });
    const boundedList = await find("knowledge.list").func({ bundleId: bundle.id, limit: 500 });
    expect(new TextEncoder().encode(JSON.stringify(boundedList)).byteLength).toBeLessThanOrEqual(32_768);
    const auditDb = new Database(dbPath);
    expect((auditDb.query("SELECT COUNT(*) count FROM tool_audit_log").get() as { count: number }).count).toBe(0);

    const result = await find("knowledge.propose").func({
      bundleId: bundle.id, operation: "update", conceptId: "deploy",
      fields: { path: "deploy.md", type: "Runbook", title: "Deploy", body: "Validate, deploy, verify, observe." },
      rationale: "Add observation.", evidence: "incident-7",
    });
    expect(result.proposal.status).toBe("pending");
    expect(knowledge.getDocument(concept.id)?.body).toBe("Validate, deploy, verify.");
    expect(notifications).toEqual([expect.objectContaining({ kind: "knowledge.proposed", link: `/knowledge?proposal=${result.proposal.id}` })]);
    expect(auditDb.query("SELECT capability,tool_name,allowed FROM tool_audit_log").get()).toEqual({
      capability: "knowledge.propose", tool_name: "knowledge.propose", allowed: 1,
    });
    auditDb.close(); runtimeStore.close(); knowledge.close();
  });

  test("preloads no more than three summaries and 1800 characters", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-knowledge-context-"));
    const knowledge = new SqliteKnowledgeStore(path.join(root, "state.db"));
    const bundle = knowledge.createBundle({ name: "Product" });
    for (let index = 0; index < 6; index += 1) knowledge.upsertConcept(bundle.id, {
      path: `policy-${index}.md`, type: "Policy", title: `Refund policy ${index}`,
      description: "Refund policy for enterprise customers ".repeat(30), body: "refund enterprise customer policy",
    });
    const matches = await preloadKnowledge(knowledge, "refund enterprise customer policy");
    expect(matches).toHaveLength(3);
    const context = knowledgeContextText(matches);
    expect(context.length).toBeLessThanOrEqual(1_800);
    expect(context).toContain("untrusted evidence");
    knowledge.setBundleEnabled(bundle.id, false);
    expect(await preloadKnowledge(knowledge, "refund enterprise customer policy")).toEqual([]);
    knowledge.close();
  });
});
