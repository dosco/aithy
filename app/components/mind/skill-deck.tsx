import { AnimatePresence, LayoutGroup } from "framer-motion";
import type { SkillDto } from "@/server/dto";
import {
  NewSkillCard,
  SkillCard,
  SkillEditorCard,
  type SkillEditorCardProps,
} from "./skill-card";

export const NEW_SKILL_ID = "__new__";

interface SkillDeckProps {
  skills: SkillDto[];
  openId: string | null;
  editorProps: SkillEditorCardProps;
  onOpen: (skill: SkillDto) => void;
  onStartNew: () => void;
  emptyAll: boolean;
  sentinelRef?: ((node: HTMLElement | null) => void) | null;
}

export function SkillDeck({
  skills,
  openId,
  editorProps,
  onOpen,
  onStartNew,
  emptyAll,
  sentinelRef,
}: SkillDeckProps) {
  if (emptyAll && openId !== NEW_SKILL_ID) {
    return <EmptyDeck onStartNew={onStartNew} />;
  }
  return (
    <LayoutGroup id="skill-deck">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {openId === NEW_SKILL_ID ? (
            <SkillEditorCard key="__editor_new" {...editorProps} />
          ) : (
            <NewSkillCard key="__new" onClick={onStartNew} />
          )}
          {skills.map((skill) => {
            if (openId === skill.id) {
              return <SkillEditorCard key={`__editor_${skill.id}`} {...editorProps} />;
            }
            return <SkillCard key={skill.id} entry={skill} onOpen={() => onOpen(skill)} />;
          })}
        </AnimatePresence>
        {sentinelRef ? (
          <li ref={sentinelRef} aria-hidden className="col-span-full h-1" />
        ) : null}
      </ul>
    </LayoutGroup>
  );
}

function EmptyDeck({ onStartNew }: { onStartNew: () => void }) {
  return (
    <div className="grid place-items-center py-16">
      <button
        type="button"
        onClick={onStartNew}
        className="group flex flex-col items-center gap-3 rounded-3xl border border-dashed border-[rgb(var(--border))] px-12 py-10 text-center transition hover:border-[rgb(var(--foreground))]/40"
      >
        <pre
          aria-hidden
          className="select-none whitespace-pre font-mono text-[11px] leading-[1.05] tracking-[0.2em] text-[rgb(var(--ascii))]"
        >
{`+   ·   ·
  ◇   ·
·   ·   +`}
        </pre>
        <p className="max-w-sm text-sm text-[rgb(var(--muted-foreground))]">
          i don't know any skills yet — paste a markdown skill above or click here to teach me one
          from scratch.
        </p>
      </button>
    </div>
  );
}
