import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, SendHorizontal, Square, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { listSkillsPaged } from "@/server/skills-memory.functions";
import type { SkillDto } from "@/server/dto";
import { visibleWebSlashCommands } from "../../src/commands/web-commands";
import type { WebLiveEvent } from "../../src/web/live-events";

export interface SelectedSkill {
  id: string;
  name: string;
}

type SetupStatusEvent = Extract<WebLiveEvent, { type: "setup-status" }>;

export function ChatComposer({
  input,
  sending,
  setupStatuses,
  selectedSkills,
  onInputChange,
  onSelectedSkillsChange,
  onSubmit,
  onStop,
}: {
  input: string;
  sending: boolean;
  setupStatuses: SetupStatusEvent[];
  selectedSkills: SelectedSkill[];
  onInputChange: (value: string) => void;
  onSelectedSkillsChange: (value: SelectedSkill[]) => void;
  onSubmit: () => void;
  onStop: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillResults, setSkillResults] = useState<SkillDto[]>([]);
  const [skillResultsTitle, setSkillResultsTitle] = useState("Top retrieved skills");
  const trimmed = input.trim();
  const canSubmit = trimmed.length > 0;
  const commandQuery = trimmed.startsWith("/") && !trimmed.includes(" ") ? trimmed : "";
  const commands = useMemo(() => visibleWebSlashCommands(commandQuery), [commandQuery]);
  const showCommands = commandQuery.length > 0 && commands.length > 0 && !skillsOpen;

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 240)}px`;
  }, [input]);

  useEffect(() => {
    if (!skillsOpen) return;
    let cancelled = false;
    const query = skillQuery.trim();
    const input = query
      ? { cursor: null, query, limit: 10 }
      : { cursor: null, limit: 10, sort: "retrieved" as const };
    void listSkillsPaged({ data: input }).then(async (result) => {
      if (cancelled) return;
      if (query && result.items.length === 0) {
        const fallback = await listSkillsPaged({
          data: { cursor: null, limit: 10, sort: "retrieved" },
        });
        if (!cancelled) {
          setSkillResults(fallback.items);
          setSkillResultsTitle("No match. Top retrieved skills");
        }
        return;
      }
      setSkillResultsTitle(query ? "Matching skills" : "Top retrieved skills");
      setSkillResults(result.items);
    });
    return () => {
      cancelled = true;
    };
  }, [skillsOpen, skillQuery]);

  function openSkills() {
    setSkillsOpen(true);
    onInputChange("");
  }

  function submit() {
    if (trimmed === "/skills") {
      openSkills();
      return;
    }
    onSubmit();
  }

  function toggleSkill(skill: SkillDto) {
    const exists = selectedSkills.some((entry) => entry.id === skill.id);
    if (exists) {
      onSelectedSkillsChange(selectedSkills.filter((entry) => entry.id !== skill.id));
    } else {
      onSelectedSkillsChange([...selectedSkills, { id: skill.id, name: skill.name }]);
    }
  }

  return (
    <div className="app-chat-composer-wrap sticky bottom-0 z-10 -mx-4 mt-6 bg-gradient-to-t from-[rgb(var(--background))] from-50% to-transparent px-4 pb-6 pt-6 sm:-mx-8 sm:px-8">
      <div className="relative">
        <AnimatePresence>
          {showCommands ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md overflow-hidden rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] shadow-lg"
            >
              {commands.map((command) => (
                <button
                  key={command.name}
                  type="button"
                  onClick={openSkills}
                  className="grid w-full gap-0.5 px-4 py-3 text-left transition hover:bg-[rgb(var(--muted))]/50"
                >
                  <span className="font-mono text-sm">{command.label}</span>
                  <span className="text-xs text-[rgb(var(--muted-foreground))]">
                    {command.description}
                  </span>
                </button>
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {skillsOpen ? (
          <div className="mb-2 grid gap-2 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-3 shadow-lg">
            <div className="flex items-center gap-2 rounded-xl border border-[rgb(var(--border))] px-3">
              <Search className="h-4 w-4 text-[rgb(var(--muted-foreground))]" />
              <input
                value={skillQuery}
                onChange={(event) => setSkillQuery(event.target.value)}
                placeholder="Search skills"
                className="h-10 flex-1 bg-transparent text-sm outline-none"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setSkillsOpen(false)}
                aria-label="Close skills selector"
                className="text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid max-h-64 gap-1 overflow-y-auto">
              {skillResults.length === 0 ? (
                <div className="px-2 py-3 text-sm text-[rgb(var(--muted-foreground))]">
                  No skills yet.
                </div>
              ) : (
                <>
                  <div className="px-2 pb-1 pt-2 text-[11px] font-medium text-[rgb(var(--muted-foreground))]">
                    {skillResultsTitle}
                  </div>
                  {skillResults.map((skill) => {
                    const selected = selectedSkills.some((entry) => entry.id === skill.id);
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => toggleSkill(skill)}
                        className={cn(
                          "grid gap-0.5 rounded-xl px-3 py-2 text-left text-sm transition",
                          selected ? "bg-[rgb(var(--accent))] text-[rgb(var(--accent-foreground))]" : "hover:bg-[rgb(var(--muted))]/50",
                        )}
                      >
                        <span className="flex min-w-0 items-center justify-between gap-3">
                          <span className="truncate font-medium">{skill.name}</span>
                          {skill.retrievedCount > 0 ? (
                            <span className={cn("shrink-0 text-[11px]", !selected && "text-[rgb(var(--muted-foreground))]")}>
                              retrieved {skill.retrievedCount}x
                            </span>
                          ) : null}
                        </span>
                        {skill.description ? (
                          <span className={cn("truncate text-xs", !selected && "text-[rgb(var(--muted-foreground))]")}>
                            {skill.description}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        ) : null}

        <SetupStatusLog statuses={setupStatuses} />

        <div className="app-chat-composer group flex flex-col gap-2 rounded-[24px] border border-[rgb(var(--border))]/90 bg-[rgb(var(--panel))]/95 px-4 py-2.5 shadow-[0_14px_40px_rgb(0_0_0/0.07),0_1px_2px_rgb(0_0_0/0.08)] backdrop-blur transition focus-within:border-[rgb(var(--foreground))]/30 focus-within:shadow-[0_18px_48px_rgb(0_0_0/0.1),0_0_0_3px_rgb(var(--accent)/0.12)] sm:px-5">
          {selectedSkills.length > 0 ? (
            <div className="flex flex-wrap gap-2 pt-2">
              {selectedSkills.map((skill) => (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => onSelectedSkillsChange(selectedSkills.filter((entry) => entry.id !== skill.id))}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[rgb(var(--border))] px-2.5 py-1 text-xs text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))]"
                >
                  <span className="truncate">{skill.name}</span>
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex items-end gap-3">
            <Textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="Hey Aithy"
              className="max-h-60 min-h-11 overflow-y-auto rounded-none border-0 bg-transparent px-0 py-2.5 text-[1.0625rem] leading-6 shadow-none placeholder:text-[rgb(var(--muted-foreground))]/80 focus:border-0"
            />
            <button
              type="button"
              onClick={sending ? onStop : submit}
              disabled={!sending && !canSubmit}
              aria-label={sending ? "Stop" : "Send"}
              className={cn(
                "mb-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-full border transition duration-200 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))]/35 focus:ring-offset-2 focus:ring-offset-[rgb(var(--panel))]",
                sending || canSubmit
                  ? "border-transparent bg-[rgb(var(--accent))] text-[rgb(var(--accent-foreground))] shadow-[0_8px_22px_rgb(var(--accent)/0.24)] hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgb(var(--accent)/0.28)]"
                  : "border-[rgb(var(--border))]/80 bg-[rgb(var(--muted))]/55 text-[rgb(var(--muted-foreground))]/70 disabled:pointer-events-none",
              )}
            >
              {sending ? <Square className="h-3.5 w-3.5 fill-current" /> : <SendHorizontal className="h-4.5 w-4.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SetupStatusLog({ statuses }: { statuses: SetupStatusEvent[] }) {
  return (
    <AnimatePresence initial={false}>
      {statuses.length > 0 ? (
        <motion.div
          key="setup-status-log"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          className="mb-2 grid gap-1.5 px-1 font-mono text-[11px] leading-none"
          role="status"
          aria-live="polite"
        >
          {statuses.map((status) => (
            <SetupStatusRow key={status.id} status={status} />
          ))}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function SetupStatusRow({ status }: { status: SetupStatusEvent }) {
  const determinate = typeof status.progress === "number";
  return (
    <motion.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 3 }}
      className={cn(
        "flex min-w-0 items-center gap-2",
        status.tone === "danger"
          ? "text-[rgb(var(--danger))]"
          : "text-[rgb(var(--muted-foreground))]",
      )}
    >
      <span className="min-w-0 truncate">{status.label}</span>
      {status.loadedBytes !== undefined && status.totalBytes !== undefined ? (
        <span className="shrink-0 text-[10px] opacity-75">
          {formatBytes(status.loadedBytes)} / {formatBytes(status.totalBytes)}
        </span>
      ) : null}
      <span className="relative h-1 w-28 shrink-0 overflow-hidden rounded-full bg-[rgb(var(--border))]" aria-hidden>
        {determinate ? (
          <motion.span
            className="absolute inset-y-0 left-0 rounded-full bg-[rgb(var(--accent))]"
            initial={false}
            animate={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }}
            transition={{ duration: 0.2 }}
          />
        ) : (
          <motion.span
            className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-[rgb(var(--accent))]"
            animate={{ x: ["-120%", "320%"] }}
            transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity }}
          />
        )}
      </span>
    </motion.div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
