import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "bun:test";
import { Markdown } from "../app/components/markdown";
import { KnowledgeImportDialog } from "../app/components/knowledge/knowledge-import-dialog";
import { KnowledgeProposals } from "../app/components/knowledge/knowledge-proposals";
import type { KnowledgeBundle, KnowledgeProposalReview, OkfImportPreview } from "../src/knowledge/types";

describe("Knowledge Library UI", () => {
  test("renders reviewed import counts and proposal decisions", () => {
    const preview = {
      name: "Operations", slug: "operations", description: "", okfVersion: "0.1", files: [],
      added: ["deploy.md"], changed: [], removed: ["old.md"], invalid: [],
      brokenLinks: [{ path: "deploy.md", target: "missing.md" }], warnings: ["Review broken links."], importHash: "hash",
    } satisfies OkfImportPreview;
    const importHtml = renderToStaticMarkup(<KnowledgeImportDialog preview={preview} busy={false} onClose={() => {}} onSave={() => {}} />);
    expect(importHtml).toContain("Reviewed import");
    expect(importHtml).toContain("Broken links");
    expect(importHtml).toContain("Snapshot replacement");
    const bundle = knowledgeBundle();
    const proposal = knowledgeProposal(bundle.id);
    const proposalHtml = renderToStaticMarkup(<KnowledgeProposals proposals={[proposal]} bundles={[bundle]} onResolve={async () => {}} />);
    expect(proposalHtml).toContain("1 proposal awaiting review");
    expect(proposalHtml).toContain("Reject");
    expect(proposalHtml).toContain("Accept");
    expect(proposalHtml).toContain("Review changes");
    expect(proposalHtml).toContain("Current body");
    expect(proposalHtml).toContain("Updated body");
  });

  test("escapes untrusted Markdown and blocks unsafe links", () => {
    const html = renderToStaticMarkup(<Markdown text={'# Evidence\n\n<script>alert("no")</script> [unsafe](javascript:alert(1))'} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  test("registers the route, navigation, loader, protected actions, and export", async () => {
    const [tree, shell, route, actions] = await Promise.all([
      readFile(new URL("../app/routeTree.gen.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/components/shell.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/routes/knowledge.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/server/knowledge.functions.ts", import.meta.url), "utf8"),
    ]);
    expect(tree).toContain("'/knowledge'");
    expect(tree).toContain("'/api/knowledge/$bundleId'");
    expect(shell).toContain('{ to: "/knowledge", label: "Knowledge"');
    expect(route).toContain("loader: () => getKnowledgePageState()");
    for (const action of ["previewKnowledgeImport", "saveKnowledgeImport", "resolveKnowledgeProposal", "updateKnowledgeBundle", "deleteKnowledgeBundle"]) expect(actions).toContain(`export const ${action}`);
    expect(actions.match(/assertLoopbackRequest\(getRequest\(\)\)/g)?.length).toBeGreaterThanOrEqual(9);
    expect(actions).toContain("maxBytes: 1_048_576");
  });
});

function knowledgeBundle(): KnowledgeBundle {
  return { id: crypto.randomUUID(), name: "Operations", slug: "operations", description: "", source: "manual", okfVersion: null,
    enabled: true, importHash: null, createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z", importedAt: null };
}

function knowledgeProposal(bundleId: string): KnowledgeProposalReview {
  return { id: crypto.randomUUID(), bundleId, operation: "update", targetDocumentId: crypto.randomUUID(), conceptId: "deploy",
    fields: { path: "deploy.md", type: "Runbook", title: "Deploy", body: "Updated body" }, rationale: "Keep it current.", evidence: ["release-42"],
    currentFields: { path: "deploy.md", type: "Runbook", title: "Deploy", body: "Current body" }, previewTruncated: false,
    sourceSessionId: "session-1", baseContentHash: "hash", status: "pending", createdAt: "2026-07-14T00:00:00.000Z", resolvedAt: null };
}
