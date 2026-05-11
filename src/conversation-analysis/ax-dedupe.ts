import { ax, f } from "@ax-llm/ax";

const signature = f()
  .input("candidate", f.string("The newly extracted candidate item."))
  .input("matches", f.string("Possibly related existing items found by the caller's search callback."))
  .input("criteria", f.string("Caller-specific rules for when candidate duplicates an existing item."))
  .output("duplicate", f.boolean("True only when the candidate is already captured by an existing item."))
  .output("reason", f.string("Brief reason for the decision."))
  .build();

const description = `You are a duplicate checker for incremental conversation extraction.

Decide whether a newly extracted candidate is already captured by any searched existing item.

Rules:
- Return duplicate=true only when an existing item preserves the same durable meaning.
- Return duplicate=false when the candidate adds a materially new fact, preference, constraint, action, or nuance.
- Similar wording, shared keywords, or the same topic are not enough by themselves.
- Prefer false when uncertain.`;

export interface AxDedupeJudge<TItem, TMatch> {
  item: TItem;
  matches: readonly TMatch[];
  criteria: string;
  formatItem: (item: TItem) => string;
  formatMatch: (match: TMatch) => string;
}

export interface AxDedupeDecision {
  duplicate: boolean;
  reason: string;
}

export interface AxDedupeDecider<TItem, TMatch> {
  decide(input: AxDedupeJudge<TItem, TMatch>): Promise<AxDedupeDecision>;
  readonly program: unknown;
}

export function createAxDedupeDecider<TItem, TMatch>(llm: unknown): AxDedupeDecider<TItem, TMatch> {
  const program = ax(signature, {
    description,
    maxSteps: 1,
    debug: false,
  } as any);
  return {
    program,
    async decide(input) {
      if (input.matches.length === 0) return { duplicate: false, reason: "no matches" };
      const result = await program.forward(llm as any, {
        candidate: input.formatItem(input.item),
        matches: input.matches.map((match, index) => {
          return `#${index + 1}\n${input.formatMatch(match)}`;
        }).join("\n\n"),
        criteria: input.criteria,
      });
      return {
        duplicate: result.duplicate === true,
        reason: String(result.reason ?? ""),
      };
    },
  };
}
