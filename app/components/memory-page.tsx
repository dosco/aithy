import { useCallback, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDownWideNarrow, Check, ChevronDown, Clock3, SlidersHorizontal } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { ThemeSync } from "@/components/theme-sync";
import { fieldClass } from "./lib/form-bits";
import {
  useDebouncedValue,
  useInfinitePage,
} from "./lib/use-infinite-page";
import { cn } from "@/lib/utils";
import {
  deleteMemory,
  listMemoriesPaged,
  upsertMemory,
} from "@/server/skills-memory.functions";
import type { MemoriesCursor, MemoryDto, WebStateDto } from "@/server/dto";
import type { MemoryKind, MemoryLabel } from "../../src/memory/types";
import { AnimatedCount } from "./mind/animated-count";
import { LivenessRibbon } from "./mind/liveness-ribbon";
import {
  MemoryLattice,
  NEW_MEMORY_ID,
} from "./mind/memory-lattice";
import { emptyMemoryForm, type MemoryForm } from "./mind/memory-tile";
import { KIND_GLYPH, KIND_TINT_TEXT } from "./mind/kind-glyph";
import { MEMORY_KINDS, MEMORY_LABELS } from "../../src/memory/types";

export function MemoryPage({ initialState }: { initialState: WebStateDto }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<MemoryForm>(emptyMemoryForm);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<MemoryKind | "all">("all");
  const [labelFilter, setLabelFilter] = useState<MemoryLabel | "all">("all");
  const [sort, setSort] = useState<"recent" | "retrieved">("recent");
  const [memoriesCount, setMemoriesCount] = useState(initialState.memoriesCount);
  const [mostRecent, setMostRecent] = useState<{ title: string } | null>(
    initialState.memoriesMostRecent,
  );

  const debouncedFilter = useDebouncedValue(filter, 200);
  const queryArg = debouncedFilter.trim();
  const kindArg = kindFilter === "all" ? undefined : kindFilter;
  const resetKey = `${queryArg}|${kindFilter}|${labelFilter}|${sort}`;

  const fetchPage = useCallback(
    async (cursor: MemoriesCursor | null) => {
      const res = await listMemoriesPaged({
        data: {
          cursor,
          query: queryArg || undefined,
          kind: kindArg,
          labels: labelFilter === "all" ? undefined : [labelFilter],
          sort,
        },
      });
      if (cursor === null && res.total !== null) {
        setMemoriesCount(res.total);
      }
      return { items: res.items, nextCursor: res.nextCursor };
    },
    [queryArg, kindArg, labelFilter, sort],
  );

  const {
    items: memories,
    sentinelRef,
    prependItem,
    replaceItem,
    removeItem,
    done,
  } = useInfinitePage<MemoryDto, MemoriesCursor>({
    initial: {
      items: initialState.memories,
      nextCursor: initialState.memoriesNextCursor,
    },
    fetchPage,
    resetKey,
  });

  function openMemory(entry: MemoryDto) {
    setOpenId(entry.id);
    setForm({
      kind: entry.kind,
      title: entry.title,
      body: entry.body,
      labels: entry.labels,
      validFrom: entry.validFrom ?? "",
      validUntil: entry.validUntil ?? "",
      evidence: entry.evidence ?? "",
      frequency: entry.frequency ?? "",
      importance: entry.importance,
    });
    setError(null);
  }

  function startNew() {
    setOpenId(NEW_MEMORY_ID);
    setForm(emptyMemoryForm);
    setError(null);
  }

  function close() {
    setOpenId(null);
    setForm(emptyMemoryForm);
    setError(null);
  }

  async function save() {
    setError(null);
    if (!form.title.trim() || !form.body.trim()) {
      setError("Title and body are required");
      return;
    }
    const dateError = validateMemoryDates(form);
    if (dateError) {
      setError(dateError);
      return;
    }
    try {
      const editing = openId !== null && openId !== NEW_MEMORY_ID;
      const entry = await upsertMemory({
        data: {
          id: editing ? openId : undefined,
          kind: form.kind,
          title: form.title.trim(),
          body: form.body,
          labels: form.labels,
          validFrom: form.validFrom || null,
          validUntil: form.validUntil || null,
          evidence: form.evidence || null,
          frequency: form.frequency || null,
          importance: form.importance,
        },
      });
      if (editing) {
        replaceItem(entry.id, entry);
      } else {
        prependItem(entry);
        setMemoriesCount((c) => c + 1);
      }
      setMostRecent({ title: entry.title });
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save memory");
    }
  }

  async function remove(id: string) {
    const result = await deleteMemory({ data: { id } });
    if (result.removed) {
      removeItem(id);
      setMemoriesCount(result.memoriesCount);
      setMostRecent(result.memoriesMostRecent);
    }
    if (openId === id) close();
  }

  const title =
    memoriesCount === 0 ? (
      <span>i don't remember anything yet.</span>
    ) : (
      <span>
        i remember <AnimatedCount value={memoriesCount} />{" "}
        {memoriesCount === 1 ? "thing" : "things"}.
      </span>
    );
  const subtitle = mostRecent ? <>most recent · &ldquo;{mostRecent.title}&rdquo;</> : undefined;

  const editorProps = {
    form,
    onChange: setForm,
    error,
    onSave: save,
    onCancel: close,
    onDelete: openId && openId !== NEW_MEMORY_ID ? () => void remove(openId) : undefined,
    editing: openId !== null && openId !== NEW_MEMORY_ID,
  };

  return (
    <PageFrame eyebrow="Memory" title={title} subtitle={subtitle}>
      <ThemeSync ui={initialState.settings.ui} />

      <LivenessRibbon initialRuns={initialState.memoryRuns} />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          className={cn(fieldClass, "max-w-sm flex-1 rounded-full sm:flex-none")}
          placeholder="filter memories…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <MemoryViewMenu
          kind={kindFilter}
          label={labelFilter}
          sort={sort}
          onKindChange={setKindFilter}
          onLabelChange={setLabelFilter}
          onSortChange={setSort}
        />
      </div>

      <MemoryLattice
        memories={memories}
        openId={openId}
        editorProps={editorProps}
        onOpen={openMemory}
        onStartNew={startNew}
        emptyAll={memoriesCount === 0 && memories.length === 0}
        sentinelRef={done ? null : sentinelRef}
      />
    </PageFrame>
  );
}

function validateMemoryDates(form: MemoryForm): string | null {
  if (form.validFrom && form.validUntil && form.validUntil < form.validFrom) {
    return "Valid until must be on or after valid from";
  }
  if (form.validUntil && form.validUntil < todayLocalDate()) {
    return "This memory is already expired";
  }
  return null;
}

function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function MemoryViewMenu({
  kind,
  label,
  sort,
  onKindChange,
  onLabelChange,
  onSortChange,
}: {
  kind: MemoryKind | "all";
  label: MemoryLabel | "all";
  sort: "recent" | "retrieved";
  onKindChange: (value: MemoryKind | "all") => void;
  onLabelChange: (value: MemoryLabel | "all") => void;
  onSortChange: (value: "recent" | "retrieved") => void;
}) {
  const sortItems = [
    { value: "recent" as const, label: "Recent", icon: Clock3 },
    { value: "retrieved" as const, label: "Top retrieved", icon: ArrowDownWideNarrow },
  ];
  const kindItems: Array<MemoryKind | "all"> = ["all", ...MEMORY_KINDS];
  const labelItems: Array<MemoryLabel | "all"> = ["all", ...MEMORY_LABELS];
  const kindLabel = kind === "all" ? "All kinds" : kind;
  const labelLabel = label === "all" ? "All labels" : label.replace("_", " ");
  const sortLabel = sort === "recent" ? "Recent" : "Top retrieved";

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-10 items-center gap-2 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/75 px-3 text-sm text-[rgb(var(--foreground))] transition hover:bg-[rgb(var(--panel))]"
        >
          <SlidersHorizontal className="h-4 w-4 text-[rgb(var(--muted-foreground))]" />
          <span className="hidden sm:inline">View</span>
          <span className="text-[rgb(var(--muted-foreground))]">
            {kindLabel} · {labelLabel} · {sortLabel}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-[rgb(var(--muted-foreground))]" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-40 w-64 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-2 shadow-xl outline-none"
        >
          <div className="px-2 py-1.5 text-[11px] font-medium text-[rgb(var(--muted-foreground))]">
            Sort
          </div>
          <div className="grid gap-1">
            {sortItems.map((item) => {
              const active = sort === item.value;
              const Icon = item.icon;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => onSortChange(item.value)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition",
                    active ? "bg-[rgb(var(--muted))]" : "hover:bg-[rgb(var(--muted))]/60",
                  )}
                >
                  <Icon className="h-4 w-4 text-[rgb(var(--muted-foreground))]" />
                  <span className="flex-1">{item.label}</span>
                  {active ? <Check className="h-4 w-4" /> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-2 border-t border-[rgb(var(--border))] px-2 pb-1 pt-3 text-[11px] font-medium text-[rgb(var(--muted-foreground))]">
            Kind
          </div>
          <div className="grid gap-1">
            {kindItems.map((item) => {
              const active = kind === item;
              const glyph = item === "all" ? "·" : KIND_GLYPH[item];
              const tint = item === "all" ? "" : KIND_TINT_TEXT[item];
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => onKindChange(item)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm capitalize transition",
                    active ? "bg-[rgb(var(--muted))]" : "hover:bg-[rgb(var(--muted))]/60",
                  )}
                >
                  <span className={cn("w-4 text-center text-base leading-none", tint)}>{glyph}</span>
                  <span className="flex-1">{item === "all" ? "All kinds" : item}</span>
                  {active ? <Check className="h-4 w-4" /> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-2 border-t border-[rgb(var(--border))] px-2 pb-1 pt-3 text-[11px] font-medium text-[rgb(var(--muted-foreground))]">
            Label
          </div>
          <div className="grid max-h-64 gap-1 overflow-auto">
            {labelItems.map((item) => {
              const active = label === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => onLabelChange(item)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm capitalize transition",
                    active ? "bg-[rgb(var(--muted))]" : "hover:bg-[rgb(var(--muted))]/60",
                  )}
                >
                  <span className="flex-1">{item === "all" ? "All labels" : item.replace("_", " ")}</span>
                  {active ? <Check className="h-4 w-4" /> : null}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
