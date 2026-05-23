import { describe, expect, test } from "bun:test";
import { buildRetrievalQueryPlan } from "../src/retrieval/query-plan";

describe("retrieval query planning", () => {
  test("extracts paths, quoted text, tool names, flags, and error anchors", () => {
    const plan = buildRetrievalQueryPlan([
      "What did we decide about `src/prompts/SOUL.md` after memory.recall failed with ENOENT --verbose?",
    ]);

    expect(plan.hasAnchors).toBe(true);
    expect(plan.anchorTerms).toContain("src/prompts/SOUL.md");
    expect(plan.anchorTerms).toContain("memory.recall");
    expect(plan.anchorTerms).toContain("--verbose");
    expect(plan.anchorTerms).toContain("ENOENT");
    expect(plan.lexicalQueries.map((query) => query.lane)).toContain("phrase");
    expect(plan.lexicalQueries.map((query) => query.lane)).toContain("tokens");
  });

  test("normal prose still gets phrase and token lanes without anchors", () => {
    const plan = buildRetrievalQueryPlan(["coffee planning near downtown"]);

    expect(plan.hasAnchors).toBe(false);
    expect(plan.semanticQueries).toEqual(["coffee planning near downtown"]);
    expect(plan.lexicalQueries.map((query) => query.lane)).toEqual(["phrase", "tokens"]);
  });
});
