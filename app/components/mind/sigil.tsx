import { useMemo } from "react";
import { cn } from "@/lib/utils";

const GLYPHS = ["·", "·", "·", "◇", "◆", "▲", "▽", "○", "●", "—", "|", "/", "\\", "+"];

function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function buildGrid(seed: string): string[][] {
  const rows: string[][] = [];
  for (let r = 0; r < 3; r++) {
    const row: string[] = [];
    for (let c = 0; c < 4; c++) {
      const h = hash32(`${seed}:${r}:${c}`);
      row.push(GLYPHS[h % GLYPHS.length]!);
    }
    rows.push(row);
  }
  return rows;
}

export function Sigil({
  id,
  className,
  size = "sm",
}: {
  id: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const grid = useMemo(() => buildGrid(id || "_"), [id]);
  const sizing = size === "md" ? "text-base leading-[1.05]" : "text-[11px] leading-[1.05]";
  return (
    <pre
      aria-hidden
      className={cn(
        "select-none whitespace-pre font-mono tracking-[0.2em] text-[rgb(var(--ascii))]",
        sizing,
        className,
      )}
    >
      {grid.map((row) => row.join(" ")).join("\n")}
    </pre>
  );
}
