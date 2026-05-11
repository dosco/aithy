import { cn } from "@/lib/utils";
import type { MemoryKind } from "../../../src/memory/types";

export const KIND_GLYPH: Record<MemoryKind, string> = {
  fact: "◇",
  preference: "♡",
  instruction: "▸",
  event: "✶",
};

export const KIND_TINT_TEXT: Record<MemoryKind, string> = {
  fact: "text-sky-600 dark:text-sky-400",
  preference: "text-violet-600 dark:text-violet-400",
  instruction: "text-emerald-600 dark:text-emerald-400",
  event: "text-amber-600 dark:text-amber-400",
};

export const KIND_TINT_BG: Record<MemoryKind, string> = {
  fact: "bg-sky-500/[0.06]",
  preference: "bg-violet-500/[0.06]",
  instruction: "bg-emerald-500/[0.06]",
  event: "bg-amber-500/[0.06]",
};

export const KIND_TINT_BORDER: Record<MemoryKind, string> = {
  fact: "border-sky-500/25",
  preference: "border-violet-500/25",
  instruction: "border-emerald-500/25",
  event: "border-amber-500/25",
};

export const KIND_TINT_RING: Record<MemoryKind, string> = {
  fact: "ring-sky-500/40",
  preference: "ring-violet-500/40",
  instruction: "ring-emerald-500/40",
  event: "ring-amber-500/40",
};

export function KindGlyph({
  kind,
  className,
}: {
  kind: MemoryKind;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em]",
        KIND_TINT_TEXT[kind],
        className,
      )}
    >
      <span aria-hidden className="text-sm leading-none">
        {KIND_GLYPH[kind]}
      </span>
      <span>{kind}</span>
    </span>
  );
}
