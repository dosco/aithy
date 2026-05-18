import { AnimatePresence, LayoutGroup } from "framer-motion";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MemoryDto } from "@/server/dto";
import { MemoryTile } from "./memory-tile";

interface MemoryLatticeProps {
  memories: MemoryDto[];
  onOpen: (entry: MemoryDto) => void;
  onStartNew: () => void;
  emptyAll: boolean;
  emptyFiltered: boolean;
  filter: string;
  loading: boolean;
  sentinelRef?: ((node: HTMLElement | null) => void) | null;
}

export function MemoryLattice({
  memories,
  onOpen,
  onStartNew,
  emptyAll,
  emptyFiltered,
  filter,
  loading,
  sentinelRef,
}: MemoryLatticeProps) {
  const newest = memories.reduce<MemoryDto | null>((acc, memory) => {
    if (!memory.lastRecalledAt) return acc;
    if (!acc || (acc.lastRecalledAt && memory.lastRecalledAt > acc.lastRecalledAt)) return memory;
    return acc;
  }, null);

  if (emptyAll && !loading) return <EmptyLattice onStartNew={onStartNew} />;
  if (emptyFiltered && !loading) return <EmptyFilter filter={filter} />;

  return (
    <LayoutGroup id="memory-lattice">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {memories.map((entry) => (
            <MemoryTile
              key={entry.id}
              entry={entry}
              onOpen={() => onOpen(entry)}
              breathing={newest?.id === entry.id}
            />
          ))}
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
    <div className="rounded-lg border border-dashed border-[rgb(var(--border))] bg-[rgb(var(--panel))]/45 px-6 py-12 text-center">
      <h2 className="text-xl font-medium">No memories yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[rgb(var(--muted-foreground))]">
        Write a memory manually or let conversations build this library over time.
      </p>
      <Button type="button" onClick={onStartNew} className="mt-5 rounded-lg">
        <Plus className="h-4 w-4" /> New memory
      </Button>
    </div>
  );
}

function EmptyFilter({ filter }: { filter: string }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/45 px-6 py-10 text-center">
      <h2 className="text-lg font-medium">No matching memories</h2>
      <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">
        {filter ? <>Nothing matches &ldquo;{filter}&rdquo;. Try a different search or filter.</> : "Try a different filter."}
      </p>
    </div>
  );
}
