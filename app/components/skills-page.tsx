import { useCallback, useState } from "react";
import { FileText, Plus, Search, Upload } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { ThemeSync } from "@/components/theme-sync";
import { Button } from "@/components/ui/button";
import { fieldClass, slugify } from "./lib/form-bits";
import {
  useDebouncedValue,
  useInfinitePage,
} from "./lib/use-infinite-page";
import { cn } from "@/lib/utils";
import {
  deleteSkill,
  duplicateBuiltInSkill,
  listSkillsPaged,
  previewSkillBundleUpload,
  saveSkillBundleUpload,
  setBuiltInSkillDisabled,
  setBuiltInSkillEnabled,
  upsertSkill,
} from "@/server/skills-memory.functions";
import type { SkillDto, SkillsCursor, SkillsPageStateDto } from "@/server/dto";
import { frontmatterBoolean, frontmatterString, parseSkillMarkdown } from "../../src/skills/frontmatter";
import { SkillDeck } from "./mind/skill-deck";
import { SkillDrawer, type SkillDrawerMode } from "./mind/skill-drawer";
import { emptySkillForm, type SkillForm } from "./mind/skill-card";
import { SkillUploadReview, type SkillUploadPreview } from "./mind/skill-upload-review";

type UploadFilePayload = { path: string; content: string };
type PendingUpload = { files: UploadFilePayload[]; preview: SkillUploadPreview };

export function SkillsPage({ initialState }: { initialState: SkillsPageStateDto }) {
  const [drawerMode, setDrawerMode] = useState<SkillDrawerMode | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<SkillForm>(emptySkillForm);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [skillsCount, setSkillsCount] = useState(initialState.skillsCount);
  const [filteredCount, setFilteredCount] = useState(initialState.skillsCount);
  const [toolUniverse, setToolUniverse] = useState(initialState.skillsToolUniverse);
  const [refreshToken, setRefreshToken] = useState(0);

  const debouncedFilter = useDebouncedValue(filter, 200);
  const queryArg = debouncedFilter.trim();
  const resetKey = `${queryArg}|${refreshToken}`;

  const fetchPage = useCallback(
    async (cursor: SkillsCursor | null) => {
      const res = await listSkillsPaged({
        data: {
          cursor,
          query: queryArg || undefined,
          sort: "retrieved",
        },
      });
      if (cursor === null && res.total !== null) {
        setFilteredCount(res.total);
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
    loading,
  } = useInfinitePage<SkillDto, SkillsCursor>({
    initial: { items: initialState.skills, nextCursor: initialState.skillsNextCursor },
    fetchPage,
    resetKey,
  });

  function openSkill(skill: SkillDto) {
    setDrawerMode("edit");
    setOpenId(skill.id);
    setForm(skillToForm(skill));
    setPasteText("");
    setError(null);
  }

  function startNew() {
    setDrawerMode("new");
    setOpenId(null);
    setForm(emptySkillForm);
    setPasteText("");
    setError(null);
  }

  function startImport() {
    setDrawerMode("import");
    setOpenId(null);
    setPasteText("");
    setError(null);
  }

  function closeDrawer() {
    setDrawerMode(null);
    setOpenId(null);
    setForm(emptySkillForm);
    setPasteText("");
    setError(null);
  }

  async function save() {
    setError(null);
    if (form.sourceKind === "builtin") {
      setError("Built-in skills are read-only. Duplicate the skill before editing it.");
      return;
    }
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
      const result = await upsertSkill({
        data: {
          id,
          name: form.name.trim(),
          description: form.description.trim(),
          body: form.body,
          whenToUse: form.whenToUse.trim() || null,
          allowedTools: form.allowedTools.trim() || null,
          tags: form.tags.trim() || null,
          disableModelInvocation: form.disableModelInvocation,
          userInvocable: form.userInvocable,
          files: form.files,
        },
      });
      const editing = drawerMode === "edit" && openId !== null;
      if (editing) replaceItem(openId, result.skill);
      else prependItem(result.skill);
      setSkillsCount(result.skillsCount);
      setFilteredCount((count) => (queryArg ? count : result.skillsCount));
      setToolUniverse(result.skillsToolUniverse);
      setRefreshToken((value) => value + 1);
      closeDrawer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save skill");
    }
  }

  async function remove(id: string) {
    const result = await deleteSkill({ data: { id } });
    if (result.removed) {
      removeItem(id);
      setSkillsCount(result.skillsCount);
      setFilteredCount((count) => Math.max(0, count - 1));
      setToolUniverse(result.skillsToolUniverse);
      setRefreshToken((value) => value + 1);
    }
    if (openId === id) closeDrawer();
  }

  function applyPaste() {
    const parsed = parseSkillMarkdown(pasteText);
    setDrawerMode("new");
    setOpenId(null);
    setForm({
      id: frontmatterString(parsed.frontmatter, ["id", "slug"]) ?? slugify(frontmatterString(parsed.frontmatter, ["name"]) ?? ""),
      name: frontmatterString(parsed.frontmatter, ["name"]) ?? frontmatterString(parsed.frontmatter, ["id"]) ?? "",
      description: frontmatterString(parsed.frontmatter, ["description"]) ?? "",
      whenToUse: frontmatterString(parsed.frontmatter, ["when_to_use", "when-to-use"]) ?? "",
      allowedTools: frontmatterString(parsed.frontmatter, ["allowed-tools", "allowed_tools", "tools"]) ?? "",
      tags: frontmatterString(parsed.frontmatter, ["tags"]) ?? "",
      disableModelInvocation: frontmatterBoolean(parsed.frontmatter, ["disable-model-invocation", "disable_model_invocation"], false),
      userInvocable: frontmatterBoolean(parsed.frontmatter, ["user-invocable", "user_invocable"], true),
      body: parsed.body,
      sourceKind: "user",
      sourceId: null,
      disabledAt: null,
      duplicatedFromSourceId: null,
      files: [],
    });
    setPasteText("");
    setError(null);
  }

  async function uploadFiles(files: FileList | File[]) {
    setError(null);
    const payload = await Promise.all(Array.from(files).map(async (file) => ({
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      content: await file.text(),
    })));
    try {
      const preview = await previewSkillBundleUpload({ data: { files: payload } });
      setPendingUpload({ files: payload, preview });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview skill bundle");
    }
  }

  async function saveUpload() {
    if (!pendingUpload) return;
    try {
      const result = await saveSkillBundleUpload({
        data: {
          files: pendingUpload.files,
          confirmedOverwrite: pendingUpload.preview.exists,
        },
      });
      if (pendingUpload.preview.exists) replaceItem(result.skill.id, result.skill);
      else prependItem(result.skill);
      setSkillsCount(result.skillsCount);
      setFilteredCount((count) => (queryArg ? count : result.skillsCount));
      setToolUniverse(result.skillsToolUniverse);
      setRefreshToken((value) => value + 1);
      setPendingUpload(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save skill bundle");
    }
  }

  async function duplicateCurrentBuiltIn() {
    if (!form.sourceId) return;
    try {
      const result = await duplicateBuiltInSkill({ data: { sourceId: form.sourceId } });
      prependItem(result.skill);
      setSkillsCount(result.skillsCount);
      setFilteredCount((count) => (queryArg ? count : result.skillsCount));
      setToolUniverse(result.skillsToolUniverse);
      setRefreshToken((value) => value + 1);
      openSkill(result.skill);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate built-in skill");
    }
  }

  async function setCurrentBuiltInDisabled(disabled: boolean) {
    if (!form.sourceId || !openId) return;
    try {
      const result = disabled
        ? await setBuiltInSkillDisabled({ data: { sourceId: form.sourceId } })
        : await setBuiltInSkillEnabled({ data: { sourceId: form.sourceId } });
      replaceItem(openId, result.skill);
      setForm(skillToForm(result.skill));
      setRefreshToken((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update built-in skill");
    }
  }

  const subtitle = toolUniverse > 0
    ? `${plural(skillsCount, "skill")} · ${plural(toolUniverse, "tool")}`
    : plural(skillsCount, "skill");
  const showing =
    queryArg || filteredCount !== skillsCount
      ? `Showing ${filteredCount.toLocaleString()} of ${skillsCount.toLocaleString()}`
      : `${skillsCount.toLocaleString()} total`;

  return (
    <PageFrame eyebrow="Skills" title="Skills library" subtitle={subtitle}>
      <ThemeSync ui={initialState.settings.ui} />

      <div
        className="mb-4 grid gap-3 md:grid-cols-[minmax(18rem,1fr)_auto] md:items-center"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void uploadFiles(event.dataTransfer.files);
        }}
      >
        <label className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted-foreground))]" />
          <input
            className={cn(fieldClass, "rounded-lg pl-9")}
            placeholder="Search skills"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <div className="grid grid-cols-3 gap-2 md:flex md:justify-end">
          <Button type="button" onClick={startNew} className="w-full rounded-lg md:w-auto">
            <Plus className="h-4 w-4" /> New skill
          </Button>
          <Button type="button" variant="soft" onClick={startImport} className="w-full rounded-lg md:w-auto">
            <FileText className="h-4 w-4" />
            <span className="sm:hidden">Import</span>
            <span className="hidden sm:inline">Import markdown</span>
          </Button>
          <Button type="button" variant="soft" asChild className="w-full rounded-lg md:w-auto">
            <label>
              <Upload className="h-4 w-4" />
              <span className="sm:hidden">Upload</span>
              <span className="hidden sm:inline">Upload bundle</span>
              <input
                type="file"
                multiple
                className="hidden"
                {...{ webkitdirectory: "", directory: "" }}
                onChange={(event) => {
                  if (event.target.files) void uploadFiles(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </Button>
        </div>
      </div>

      {!drawerMode && error ? (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-[rgb(var(--muted-foreground))]">
        <span>{showing}</span>
        {loading ? <span>Loading...</span> : null}
      </div>

      <SkillDeck
        skills={skills}
        onOpen={openSkill}
        onStartNew={startNew}
        onImport={startImport}
        emptyAll={skillsCount === 0 && skills.length === 0}
        emptyFiltered={skillsCount > 0 && skills.length === 0 && !!queryArg}
        filter={queryArg}
        loading={loading}
        sentinelRef={done ? null : sentinelRef}
      />

      <SkillDrawer
        mode={drawerMode}
        form={form}
        pasteText={pasteText}
        error={error}
        links={openId ? skills.find((skill) => skill.id === openId)?.links : []}
        recentUsage={openId ? skills.find((skill) => skill.id === openId)?.recentUsage : []}
        onChange={setForm}
        onPasteTextChange={setPasteText}
        onParse={applyPaste}
        onSave={save}
        onClose={closeDrawer}
        onDelete={drawerMode === "edit" && openId ? () => void remove(openId) : undefined}
        onDuplicate={duplicateCurrentBuiltIn}
        onDisable={() => void setCurrentBuiltInDisabled(true)}
        onEnable={() => void setCurrentBuiltInDisabled(false)}
      />
      {pendingUpload ? (
        <SkillUploadReview
          preview={pendingUpload.preview}
          onCancel={() => setPendingUpload(null)}
          onSave={saveUpload}
        />
      ) : null}
    </PageFrame>
  );
}

function skillToForm(skill: SkillDto): SkillForm {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse ?? "",
    body: skill.body,
    allowedTools: skill.allowedTools ?? "",
    tags: skill.tags ?? "",
    disableModelInvocation: skill.disableModelInvocation,
    userInvocable: skill.userInvocable,
    sourceKind: skill.sourceKind,
    sourceId: skill.sourceId,
    disabledAt: skill.disabledAt,
    duplicatedFromSourceId: skill.duplicatedFromSourceId,
    files: skill.files.map((file) => ({ path: file.path, content: file.content })),
  };
}

function plural(value: number, noun: string): string {
  return `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`;
}
