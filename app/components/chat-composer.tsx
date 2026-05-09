import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, SendHorizontal, Square, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { listSkillsPaged } from "@/server/skills-memory.functions";
import type { SkillDto } from "@/server/dto";
import { visibleWebSlashCommands } from "../../src/commands/web-commands";

export interface SelectedSkill {
  id: string;
  name: string;
}

export function ChatComposer({
  input,
  sending,
  selectedSkills,
  onInputChange,
  onSelectedSkillsChange,
  onSubmit,
  onStop,
}: {
  input: string;
  sending: boolean;
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
  const trimmed = input.trim();
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
    void listSkillsPaged({ data: { cursor: null, query: skillQuery, limit: 10 } }).then((result) => {
      if (!cancelled) setSkillResults(result.items);
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
                  No matching skills.
                </div>
              ) : (
                skillResults.map((skill) => {
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
                      <span className="font-medium">{skill.name}</span>
                      {skill.description ? (
                        <span className={cn("truncate text-xs", !selected && "text-[rgb(var(--muted-foreground))]")}>
                          {skill.description}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        <div className="app-chat-composer flex flex-col gap-2 rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-5 py-2 shadow-md shadow-black/5">
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
              placeholder="Message Aithy"
              className="max-h-60 min-h-10 overflow-y-auto rounded-none border-0 bg-transparent px-0 py-2 text-base leading-6 shadow-none focus:border-0"
            />
            <button
              type="button"
              onClick={sending ? onStop : submit}
              disabled={!sending && !input.trim()}
              aria-label={sending ? "Stop" : "Send"}
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--accent))] text-[rgb(var(--accent-foreground))] transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
            >
              {sending ? <Square className="h-3 w-3 fill-current" /> : <SendHorizontal className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
