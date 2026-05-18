import { AnimatePresence, LayoutGroup } from "framer-motion";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SkillDto } from "@/server/dto";
import { SkillCard } from "./skill-card";

interface SkillDeckProps {
  skills: SkillDto[];
  onOpen: (skill: SkillDto) => void;
  onStartNew: () => void;
  onImport: () => void;
  emptyAll: boolean;
  emptyFiltered: boolean;
  filter: string;
  loading: boolean;
  sentinelRef?: ((node: HTMLElement | null) => void) | null;
}

export function SkillDeck({
  skills,
  onOpen,
  onStartNew,
  onImport,
  emptyAll,
  emptyFiltered,
  filter,
  loading,
  sentinelRef,
}: SkillDeckProps) {
  if (emptyAll && !loading) {
    return <EmptyDeck onStartNew={onStartNew} onImport={onImport} />;
  }
  if (emptyFiltered && !loading) {
    return <EmptyFilter filter={filter} />;
  }
  return (
    <LayoutGroup id="skill-deck">
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {skills.map((skill) => (
            <SkillCard key={skill.id} entry={skill} onOpen={() => onOpen(skill)} />
          ))}
        </AnimatePresence>
        {sentinelRef ? (
          <li ref={sentinelRef} aria-hidden className="col-span-full h-1" />
        ) : null}
      </ul>
    </LayoutGroup>
  );
}

function EmptyDeck({
  onStartNew,
  onImport,
}: {
  onStartNew: () => void;
  onImport: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[rgb(var(--border))] bg-[rgb(var(--panel))]/45 px-6 py-12 text-center">
      <h2 className="text-xl font-medium">No skills yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[rgb(var(--muted-foreground))]">
        Add a skill from scratch or import a markdown skill file to start building this library.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={onStartNew}>
          <Plus className="h-4 w-4" /> New skill
        </Button>
        <Button type="button" variant="soft" onClick={onImport}>
          <FileText className="h-4 w-4" /> Import markdown
        </Button>
      </div>
    </div>
  );
}

function EmptyFilter({ filter }: { filter: string }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/45 px-6 py-10 text-center">
      <h2 className="text-lg font-medium">No matching skills</h2>
      <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">
        Nothing matches &ldquo;{filter}&rdquo;. Try a different search.
      </p>
    </div>
  );
}
