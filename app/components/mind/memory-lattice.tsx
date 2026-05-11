import { AnimatePresence, LayoutGroup } from "framer-motion";
import { cn } from "@/lib/utils";
import type { MemoryDto } from "@/server/dto";
import {
  MemoryEditorTile,
  MemoryTile,
  NewMemoryTile,
  type MemoryEditorTileProps,
} from "./memory-tile";
import { KIND_GLYPH, KIND_TINT_TEXT } from "./kind-glyph";
import { MEMORY_KINDS, type MemoryKind } from "../../../src/memory/types";

export const NEW_MEMORY_ID = "__new__";

export function KindFilterRow({
  value,
  onChange,
}: {
  value: MemoryKind | "all";
  onChange: (v: MemoryKind | "all") => void;
}) {
  const items: Array<MemoryKind | "all"> = ["all", ...MEMORY_KINDS];
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/60 p-1">
      {items.map((kind) => {
        const active = value === kind;
        const tint = kind === "all" ? "" : KIND_TINT_TEXT[kind];
        const glyph = kind === "all" ? "·" : KIND_GLYPH[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onChange(kind)}
            className={cn(
              "group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition",
              active
                ? "bg-[rgb(var(--foreground))] text-[rgb(var(--background))]"
                : "text-[rgb(var(--muted-foreground))] hover:text-[rgb(var(--foreground))]",
            )}
          >
            <span aria-hidden className={cn("text-sm leading-none", !active && tint)}>
              {glyph}
            </span>
            <span>{kind}</span>
          </button>
        );
      })}
    </div>
  );
}

interface MemoryLatticeProps {
  memories: MemoryDto[];
  openId: string | null;
  editorProps: MemoryEditorTileProps;
  onOpen: (entry: MemoryDto) => void;
  onStartNew: () => void;
  emptyAll: boolean;
  sentinelRef?: ((node: HTMLElement | null) => void) | null;
}

export function MemoryLattice({
  memories,
  openId,
  editorProps,
  onOpen,
  onStartNew,
  emptyAll,
  sentinelRef,
}: MemoryLatticeProps) {
  const newest = memories.reduce<MemoryDto | null>((acc, m) => {
    if (!m.lastRecalledAt) return acc;
    if (!acc || (acc.lastRecalledAt && m.lastRecalledAt > acc.lastRecalledAt)) return m;
    return acc;
  }, null);

  if (emptyAll && openId !== NEW_MEMORY_ID) {
    return <EmptyLattice onStartNew={onStartNew} />;
  }

  return (
    <LayoutGroup id="memory-lattice">
      <ul
        className="grid grid-flow-row-dense grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        style={{ gridAutoRows: "84px" }}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {openId === NEW_MEMORY_ID ? (
            <MemoryEditorTile key="__editor_new" {...editorProps} />
          ) : (
            <NewMemoryTile key="__new" onClick={onStartNew} />
          )}
          {memories.map((entry) => {
            if (openId === entry.id) {
              return <MemoryEditorTile key={`__editor_${entry.id}`} {...editorProps} />;
            }
            return (
              <MemoryTile
                key={entry.id}
                entry={entry}
                onOpen={() => onOpen(entry)}
                breathing={newest?.id === entry.id}
              />
            );
          })}
        </AnimatePresence>
        {sentinelRef ? (
          <li ref={sentinelRef} aria-hidden className="col-span-full h-1" />
        ) : null}
      </ul>
    </LayoutGroup>
  );
}

function EmptyLattice({ onStartNew }: { onStartNew: () => void }) {
  return (
    <div className="grid place-items-center py-16">
      <button
        type="button"
        onClick={onStartNew}
        className="group flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[rgb(var(--border))] px-10 py-8 text-center transition hover:border-[rgb(var(--foreground))]/40"
      >
        <pre
          aria-hidden
          className="select-none whitespace-pre font-mono text-[11px] leading-tight tracking-[0.2em] text-[rgb(var(--ascii))]"
        >
{`·   ·   ·
  ◇   ·
·   ·   ·`}
        </pre>
        <p className="max-w-sm text-sm text-[rgb(var(--muted-foreground))]">
          i'm fresh — nothing remembered yet. tell me something or click here to write the first
          memory.
        </p>
      </button>
    </div>
  );
}
