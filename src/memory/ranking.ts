const RECENCY_HALF_LIFE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RankingInputs {
  bm25: number;
  importance: number;
  updatedAt: string;
  now?: number;
}

// Higher score = more relevant. FTS5 returns bm25 as a negative number where
// lower (more negative) means a better match, so we negate it as the base.
export function score({ bm25, importance, updatedAt, now }: RankingInputs): number {
  const base = -bm25;
  const importanceBoost = 1 + clamp01(importance);
  const ageDays = Math.max(0, ((now ?? Date.now()) - Date.parse(updatedAt)) / MS_PER_DAY);
  const recencyBoost = Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
  return base * importanceBoost * (0.5 + 0.5 * recencyBoost);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
