import type { RetrievalLane } from "./query-plan";

export const RRF_K = 60;

export interface FusedCandidate<T> {
  item: T;
  fusedScore: number;
  bestLane: RetrievalLane;
  lanes: Set<RetrievalLane>;
}

export function laneWeight(lane: RetrievalLane): number {
  switch (lane) {
    case "anchor":
      return 4.0;
    case "phrase":
      return 2.5;
    case "tokens":
      return 1.0;
    case "semantic":
      return 1.5;
  }
}

export function addFusedHit<T>(
  target: Map<string | number, FusedCandidate<T>>,
  key: string | number,
  item: T,
  lane: RetrievalLane,
  rank: number,
): void {
  const score = laneWeight(lane) / (RRF_K + rank);
  const existing = target.get(key);
  if (existing) {
    existing.fusedScore += score;
    existing.lanes.add(lane);
    if (laneWeight(lane) > laneWeight(existing.bestLane)) existing.bestLane = lane;
  } else {
    target.set(key, { item, fusedScore: score, bestLane: lane, lanes: new Set([lane]) });
  }
}

export function sortedFused<T>(target: Map<string | number, FusedCandidate<T>>): FusedCandidate<T>[] {
  return [...target.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}
