import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { SkillDto } from "@/server/dto";

export interface SkillForm {
  id: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
  allowedTools: string;
  tags: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  files: Array<{ path: string; content: string }>;
}

export const emptySkillForm: SkillForm = {
  id: "",
  name: "",
  description: "",
  whenToUse: "",
  body: "",
  allowedTools: "",
  tags: "",
  disableModelInvocation: false,
  userInvocable: true,
  files: [],
};

function splitWords(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(/\s+/).filter(Boolean);
}

export function skillToolCount(allowedTools: string | null | undefined): number {
  return splitWords(allowedTools).length;
}

export function SkillCard({ entry, onOpen }: { entry: SkillDto; onOpen: () => void }) {
  const tools = skillToolCount(entry.allowedTools);
  const tags = splitWords(entry.tags);
  const updated = formatUpdated(entry.updatedAt);

  return (
    <motion.li layout transition={{ type: "spring", stiffness: 360, damping: 32 }}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group flex h-full min-h-[132px] w-full flex-col rounded-lg border",
          "border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-3 text-left shadow-sm shadow-black/5 transition sm:p-4",
          "hover:-translate-y-0.5 hover:border-[rgb(var(--foreground))]/30 hover:shadow-md motion-reduce:hover:translate-y-0",
        )}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-medium leading-snug sm:text-lg">{entry.name}</h3>
            <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
              {entry.id}
            </p>
          </div>
          {tools > 0 ? (
            <span className="shrink-0 rounded-full border border-[rgb(var(--border))] px-2 py-0.5 text-[11px] text-[rgb(var(--muted-foreground))]">
              {tools} {tools === 1 ? "tool" : "tools"}
            </span>
          ) : null}
        </div>

        {entry.description ? (
          <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-5 text-[rgb(var(--muted-foreground))] sm:line-clamp-3">
            {entry.description}
          </p>
        ) : (
          <p className="mt-2 text-sm leading-5 text-[rgb(var(--muted-foreground))]">
            No description yet.
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="max-w-[9rem] truncate rounded-full bg-[rgb(var(--muted))] px-2 py-0.5 text-[11px] text-[rgb(var(--muted-foreground))]"
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 ? (
              <span className="rounded-full bg-[rgb(var(--muted))] px-2 py-0.5 text-[11px] text-[rgb(var(--muted-foreground))]">
                +{tags.length - 3}
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[rgb(var(--muted-foreground))]">
            <span>{entry.usedCount > 0 ? `used ${entry.usedCount}x` : "not used yet"}</span>
            <span>{entry.retrievedCount > 0 ? `loaded ${entry.retrievedCount}x` : "not loaded yet"}</span>
            <span>{updated}</span>
          </div>
        </div>
      </button>
    </motion.li>
  );
}

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "updated unknown";
  return `updated ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}
