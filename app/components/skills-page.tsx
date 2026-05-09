import { useCallback, useState } from "react";
import { FileText } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { ThemeSync } from "@/components/theme-sync";
import { Button } from "@/components/ui/button";
import { FormTextarea, fieldClass, slugify } from "./lib/form-bits";
import {
  useDebouncedValue,
  useInfinitePage,
} from "./lib/use-infinite-page";
import { cn } from "@/lib/utils";
import {
  deleteSkill,
  listSkillsPaged,
  upsertSkill,
} from "@/server/skills-memory.functions";
import type { SkillDto, SkillsCursor, WebStateDto } from "@/server/dto";
import { AnimatedCount } from "./mind/animated-count";
import { SkillDeck, NEW_SKILL_ID } from "./mind/skill-deck";
import { emptySkillForm, type SkillForm } from "./mind/skill-card";

export function SkillsPage({ initialState }: { initialState: WebStateDto }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<SkillForm>(emptySkillForm);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [skillsCount, setSkillsCount] = useState(initialState.skillsCount);
  const [toolUniverse, setToolUniverse] = useState(initialState.skillsToolUniverse);

  const debouncedFilter = useDebouncedValue(filter, 200);
  const queryArg = debouncedFilter.trim();

  const fetchPage = useCallback(
    async (cursor: SkillsCursor | null) => {
      const res = await listSkillsPaged({
        data: {
          cursor,
          query: queryArg || undefined,
        },
      });
      if (cursor === null && res.total !== null) {
        setSkillsCount(res.total);
      }
      return { items: res.items, nextCursor: res.nextCursor };
    },
    [queryArg],
  );

  const {
    items: skills,
    sentinelRef,
    prependItem,
    replaceItem,
    removeItem,
    done,
  } = useInfinitePage<SkillDto, SkillsCursor>({
    initial: { items: initialState.skills, nextCursor: initialState.skillsNextCursor },
    fetchPage,
    resetKey: queryArg,
  });

  function openSkill(skill: SkillDto) {
    setOpenId(skill.id);
    setForm({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      allowedTools: skill.allowedTools ?? "",
      tags: skill.tags ?? "",
    });
    setError(null);
  }

  function startNew() {
    setOpenId(NEW_SKILL_ID);
    setForm(emptySkillForm);
    setError(null);
  }

  function close() {
    setOpenId(null);
    setForm(emptySkillForm);
    setError(null);
  }

  async function save() {
    setError(null);
    const id = (form.id.trim() || slugify(form.name)).trim();
    if (!id || !form.name.trim()) {
      setError("Name and id are required");
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      setError("Id must be a slug (lowercase letters, digits, hyphens)");
      return;
    }
    try {
      const entry = await upsertSkill({
        data: {
          id,
          name: form.name.trim(),
          description: form.description.trim(),
          body: form.body,
          allowedTools: form.allowedTools.trim() || null,
          tags: form.tags.trim() || null,
        },
      });
      const editing = openId !== null && openId !== NEW_SKILL_ID;
      if (editing) {
        replaceItem(entry.id, entry);
      } else {
        prependItem(entry);
        setSkillsCount((c) => c + 1);
      }
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save skill");
    }
  }

  async function remove(id: string) {
    const result = await deleteSkill({ data: { id } });
    if (result.removed) {
      removeItem(id);
      setSkillsCount(result.skillsCount);
      setToolUniverse(result.skillsToolUniverse);
    }
    if (openId === id) close();
  }

  function applyPaste() {
    const parsed = parseFrontmatter(pasteText);
    setOpenId(NEW_SKILL_ID);
    setForm({
      id: parsed.frontmatter.name ? slugify(parsed.frontmatter.name) : "",
      name: parsed.frontmatter.name ?? "",
      description: parsed.frontmatter.description ?? "",
      allowedTools: parsed.frontmatter["allowed-tools"] ?? "",
      tags: parsed.frontmatter.tags ?? "",
      body: parsed.body,
    });
    setPasteText("");
    setShowImport(false);
  }

  const title =
    skillsCount === 0 ? (
      <span>i haven't been taught anything yet.</span>
    ) : (
      <span>
        i know how to do <AnimatedCount value={skillsCount} />{" "}
        {skillsCount === 1 ? "thing" : "things"}.
      </span>
    );
  const subtitle = toolUniverse > 0 ? <>across {toolUniverse} distinct tools</> : undefined;

  const editorProps = {
    form,
    onChange: setForm,
    error,
    onSave: save,
    onCancel: close,
    onDelete: openId && openId !== NEW_SKILL_ID ? () => void remove(openId) : undefined,
    editing: openId !== null && openId !== NEW_SKILL_ID,
  };

  return (
    <PageFrame eyebrow="Skills" title={title} subtitle={subtitle}>
      <ThemeSync ui={initialState.settings.ui} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          className={cn(fieldClass, "max-w-xs rounded-full")}
          placeholder="filter skills…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={() => setShowImport((v) => !v)}>
            <FileText className="h-4 w-4" /> Import markdown
          </Button>
        </div>
      </div>

      {showImport ? (
        <div className="mb-5 rounded-3xl border border-dashed border-[rgb(var(--border))] bg-[rgb(var(--panel))]/40 p-5">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
            paste a skill — frontmatter + markdown body
          </p>
          <FormTextarea
            rows={6}
            value={pasteText}
            placeholder={"---\nname: my-skill\ndescription: …\n---\n\n# Body"}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="soft" size="sm" onClick={() => setShowImport(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={applyPaste} disabled={!pasteText.trim()}>
              Parse
            </Button>
          </div>
        </div>
      ) : null}

      <SkillDeck
        skills={skills}
        openId={openId}
        editorProps={editorProps}
        onOpen={openSkill}
        onStartNew={startNew}
        emptyAll={skillsCount === 0 && skills.length === 0}
        sentinelRef={done ? null : sentinelRef}
      />
    </PageFrame>
  );
}

interface ParsedMarkdown {
  frontmatter: Record<string, string>;
  body: string;
}

function parseFrontmatter(text: string): ParsedMarkdown {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: normalized.trim() };
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) frontmatter[kv[1]] = kv[2].trim();
  }
  return { frontmatter, body: normalized.slice(match[0].length).trim() };
}
