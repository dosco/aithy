import { formatMemoryPreview } from "./format";

interface IndexedMemoryPreview {
  id: string;
  title: string;
  body: string;
}

export function memoryBackfillNotification(
  done: number,
  indexed: readonly IndexedMemoryPreview[],
): { title: string; body: string } {
  const first = indexed[0];
  const fallback = `Prepared ${done} memor${done === 1 ? "y" : "ies"} for search`;
  const body = first
    ? done === 1
      ? formatMemoryPreview(first)
      : `Prepared ${done} memories for search, including ${formatMemoryPreview(first)}`
    : fallback;

  return {
    title: done === 1 ? "Memory indexed" : "Memories indexed",
    body,
  };
}
