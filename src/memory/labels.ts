import { MEMORY_LABELS, type MemoryLabel } from "./types";

const LABELS = new Set<string>(MEMORY_LABELS);

export function normalizeMemoryLabels(input: readonly string[] | undefined): MemoryLabel[] {
  if (!input?.length) return [];
  const seen = new Set<MemoryLabel>();
  for (const value of input) {
    const label = value.trim();
    if (!LABELS.has(label)) {
      throw new Error(`Invalid memory label: ${value}. Expected one of ${MEMORY_LABELS.join(", ")}.`);
    }
    seen.add(label as MemoryLabel);
  }
  return [...seen];
}

export function labelsToJson(input: readonly MemoryLabel[] | undefined): string {
  return JSON.stringify(normalizeMemoryLabels(input));
}

export function labelsFromJson(value: string | null | undefined): MemoryLabel[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normalizeMemoryLabels(parsed.filter((v): v is string => typeof v === "string")) : [];
  } catch {
    return [];
  }
}

export function labelsToText(input: readonly MemoryLabel[]): string {
  return input.join(" ");
}
