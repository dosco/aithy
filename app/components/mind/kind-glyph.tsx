import { cn } from "@/lib/utils";
import type { MemoryKind } from "../../../src/memory/types";

export const KIND_GLYPH: Record<MemoryKind, string> = {
  fact: "◇",
  preference: "♡",
  instruction: "▸",
  relationship: "◎",
  project_context: "▣",
  decision: "◆",
  task: "□",
  goal: "△",
  event: "✶",
  resource: "⌁",
  constraint: "⊢",
  vocabulary: "Aa",
  note: "·",
};

export const KIND_TINT_TEXT: Record<MemoryKind, string> = {
  fact: "text-sky-600 dark:text-sky-400",
  preference: "text-violet-600 dark:text-violet-400",
  instruction: "text-emerald-600 dark:text-emerald-400",
  relationship: "text-rose-600 dark:text-rose-400",
  project_context: "text-cyan-700 dark:text-cyan-300",
  decision: "text-indigo-600 dark:text-indigo-400",
  task: "text-lime-700 dark:text-lime-300",
  goal: "text-fuchsia-600 dark:text-fuchsia-400",
  event: "text-amber-600 dark:text-amber-400",
  resource: "text-teal-700 dark:text-teal-300",
  constraint: "text-red-600 dark:text-red-400",
  vocabulary: "text-stone-700 dark:text-stone-300",
  note: "text-slate-600 dark:text-slate-400",
};

export const KIND_TINT_BG: Record<MemoryKind, string> = {
  fact: "bg-sky-500/[0.06]",
  preference: "bg-violet-500/[0.06]",
  instruction: "bg-emerald-500/[0.06]",
  relationship: "bg-rose-500/[0.06]",
  project_context: "bg-cyan-500/[0.06]",
  decision: "bg-indigo-500/[0.06]",
  task: "bg-lime-500/[0.06]",
  goal: "bg-fuchsia-500/[0.06]",
  event: "bg-amber-500/[0.06]",
  resource: "bg-teal-500/[0.06]",
  constraint: "bg-red-500/[0.06]",
  vocabulary: "bg-stone-500/[0.06]",
  note: "bg-slate-500/[0.06]",
};

export const KIND_TINT_BORDER: Record<MemoryKind, string> = {
  fact: "border-sky-500/25",
  preference: "border-violet-500/25",
  instruction: "border-emerald-500/25",
  relationship: "border-rose-500/25",
  project_context: "border-cyan-500/25",
  decision: "border-indigo-500/25",
  task: "border-lime-500/25",
  goal: "border-fuchsia-500/25",
  event: "border-amber-500/25",
  resource: "border-teal-500/25",
  constraint: "border-red-500/25",
  vocabulary: "border-stone-500/25",
  note: "border-slate-500/25",
};

export const KIND_TINT_RING: Record<MemoryKind, string> = {
  fact: "ring-sky-500/40",
  preference: "ring-violet-500/40",
  instruction: "ring-emerald-500/40",
  relationship: "ring-rose-500/40",
  project_context: "ring-cyan-500/40",
  decision: "ring-indigo-500/40",
  task: "ring-lime-500/40",
  goal: "ring-fuchsia-500/40",
  event: "ring-amber-500/40",
  resource: "ring-teal-500/40",
  constraint: "ring-red-500/40",
  vocabulary: "ring-stone-500/40",
  note: "ring-slate-500/40",
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
      <span>{kind.replace("_", " ")}</span>
    </span>
  );
}
