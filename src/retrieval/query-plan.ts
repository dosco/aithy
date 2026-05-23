export type RetrievalLane = "anchor" | "phrase" | "tokens" | "semantic";

export interface LexicalSearchQuery {
  raw: string;
  lane: Exclude<RetrievalLane, "semantic">;
  expression: string;
  terms: string[];
}

export interface RetrievalQueryPlan {
  rawQueries: string[];
  semanticQueries: string[];
  lexicalQueries: LexicalSearchQuery[];
  anchorTerms: string[];
  hasAnchors: boolean;
}

const MAX_ANCHORS_PER_QUERY = 8;
const MAX_TOKENS_PER_QUERY = 10;

export function buildRetrievalQueryPlan(queries: readonly string[]): RetrievalQueryPlan {
  const rawQueries = unique(queries.map((query) => query.trim()).filter(Boolean));
  const lexicalQueries: LexicalSearchQuery[] = [];
  const anchorTerms: string[] = [];
  const seenExpressions = new Set<string>();

  for (const raw of rawQueries) {
    for (const anchor of extractAnchors(raw).slice(0, MAX_ANCHORS_PER_QUERY)) {
      const expression = quoteForFts5(anchor);
      if (!expression || seenExpressions.has(`anchor:${expression}`)) continue;
      seenExpressions.add(`anchor:${expression}`);
      anchorTerms.push(anchor);
      lexicalQueries.push({ raw, lane: "anchor", expression, terms: [anchor] });
    }

    const phrase = quoteForFts5(raw);
    if (phrase && !seenExpressions.has(`phrase:${phrase}`)) {
      seenExpressions.add(`phrase:${phrase}`);
      lexicalQueries.push({ raw, lane: "phrase", expression: phrase, terms: [raw] });
    }

    const tokens = queryTokens(raw).slice(0, MAX_TOKENS_PER_QUERY);
  const tokenExpression = tokens.map(quoteForFts5).filter(Boolean).join(" AND ");
    if (tokenExpression && !seenExpressions.has(`tokens:${tokenExpression}`)) {
      seenExpressions.add(`tokens:${tokenExpression}`);
      lexicalQueries.push({ raw, lane: "tokens", expression: tokenExpression, terms: tokens });
    }
  }

  return {
    rawQueries,
    semanticQueries: rawQueries,
    lexicalQueries,
    anchorTerms: unique(anchorTerms),
    hasAnchors: anchorTerms.length > 0,
  };
}

export function quoteForFts5(raw: string): string {
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `"${cleaned}"` : "";
}

export function containsAnchor(text: string, anchors: readonly string[]): boolean {
  if (anchors.length === 0) return false;
  const normalized = normalizeForAnchor(text);
  return anchors.some((anchor) => {
    const needle = normalizeForAnchor(anchor);
    return needle.length > 0 && normalized.includes(needle);
  });
}

function extractAnchors(raw: string): string[] {
  const anchors: string[] = [];
  for (const match of raw.matchAll(/`([^`]{2,160})`|"([^"]{2,160})"|'([^']{2,160})'/g)) {
    anchors.push(match[1] ?? match[2] ?? match[3]);
  }
  for (const match of raw.matchAll(/[~./\w-]*[/][^\s`'",)]+|[\w-]+\.[\w.-]+|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|--[\w-]+|[A-Z]{2,}[-_][A-Z0-9_-]+|\b(?:ERR|ERROR|SQLSTATE|EADDRINUSE|ENOENT|ECONNREFUSED)[\w:-]*\b/g)) {
    anchors.push(match[0]);
  }
  return unique(anchors.map((anchor) => anchor.trim()).filter((anchor) => anchor.length >= 2));
}

function queryTokens(raw: string): string[] {
  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!cleaned) return [];
  return unique(cleaned.split(" ").filter((token) => token.length >= 3));
}

function normalizeForAnchor(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
