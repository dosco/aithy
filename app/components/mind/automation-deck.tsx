import { AnimatePresence, LayoutGroup } from "framer-motion";
import { Eye, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AutomationDto } from "@/server/dto";
import { AutomationCard } from "./automation-card";

interface AutomationDeckProps {
  automations: AutomationDto[];
  queuedIds: Set<string>;
  onOpen: (automation: AutomationDto) => void;
  onStartNew: () => void;
  onRunNow: (automation: AutomationDto) => void;
  onPause: (automation: AutomationDto) => void;
  onResume: (automation: AutomationDto) => void;
  onArchive: (automation: AutomationDto) => void;
  emptyAll: boolean;
  emptyFiltered: boolean;
  filter: string;
}

export function AutomationDeck({
  automations,
  queuedIds,
  onOpen,
  onStartNew,
  onRunNow,
  onPause,
  onResume,
  onArchive,
  emptyAll,
  emptyFiltered,
  filter,
}: AutomationDeckProps) {
  if (emptyAll) return <EmptyDeck onStartNew={onStartNew} />;
  if (emptyFiltered) return <EmptyFilter filter={filter} />;

  return (
    <LayoutGroup id="automation-deck">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {automations.map((automation) => (
            <AutomationCard
              key={automation.id}
              entry={automation}
              queued={queuedIds.has(automation.id)}
              onOpen={() => onOpen(automation)}
              onRunNow={() => onRunNow(automation)}
              onPause={() => onPause(automation)}
              onResume={() => onResume(automation)}
              onArchive={() => onArchive(automation)}
            />
          ))}
        </AnimatePresence>
      </ul>
    </LayoutGroup>
  );
}

function EmptyDeck({ onStartNew }: { onStartNew: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-[rgb(var(--border))] bg-[rgb(var(--panel))]/45 px-6 py-12 text-center">
      <Eye className="mx-auto h-7 w-7 text-[rgb(var(--muted-foreground))]" />
      <h2 className="mt-3 text-xl font-medium">Nothing has your agent’s attention yet.</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[rgb(var(--muted-foreground))]">
        Give the agent something to watch, remember once, repeat, or research from here.
      </p>
      <Button type="button" onClick={onStartNew} className="mt-5 rounded-lg">
        <Plus className="h-4 w-4" /> New attention
      </Button>
    </div>
  );
}

function EmptyFilter({ filter }: { filter: string }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/45 px-6 py-10 text-center">
      <h2 className="text-lg font-medium">No matching attentions</h2>
      <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">
        {filter ? <>Nothing matches &ldquo;{filter}&rdquo;. Try a different search or status.</> : "Try a different status."}
      </p>
    </div>
  );
}
