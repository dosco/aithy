import { useCallback, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDownWideNarrow, Check, ChevronDown, Clock3, Plus, Search, SlidersHorizontal } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { ThemeSync } from "@/components/theme-sync";
import { Button } from "@/components/ui/button";
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
import type { MemoriesCursor, MemoryDto, MemoryPageStateDto } from "@/server/dto";
import type { MemoryKind } from "../../src/memory/types";
import { LivenessRibbon } from "./mind/liveness-ribbon";
import { MemoryLattice } from "./mind/memory-lattice";
import { MemoryDrawer, type MemoryDrawerMode } from "./mind/memory-drawer";
import { emptyMemoryForm, type MemoryForm } from "./mind/memory-tile";
import { KIND_GLYPH, KIND_TINT_TEXT } from "./mind/kind-glyph";
import { MEMORY_KINDS } from "../../src/memory/types";

export function MemoryPage({ initialState }: { initialState: MemoryPageStateDto }) {
  const [drawerMode, setDrawerMode] = useState<MemoryDrawerMode | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<MemoryForm>(emptyMemoryForm);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<MemoryKind | "all">("all");
  const [sort, setSort] = useState<"recent" | "retrieved">("recent");
  const [memoriesCount, setMemoriesCount] = useState(initialState.memoriesCount);
  const [filteredCount, setFilteredCount] = useState(initialState.memoriesCount);
  const [mostRecent, setMostRecent] = useState<{ title: string } | null>(
    initialState.memoriesMostRecent,
  );
  const [refreshToken, setRefreshToken] = useState(0);

  const debouncedFilter = useDebouncedValue(filter, 200);
  const queryArg = debouncedFilter.trim();
  const kindArg = kindFilter === "all" ? undefined : kindFilter;
  const filtering = !!queryArg || kindFilter !== "all";
  const resetKey = `${queryArg}|${kindFilter}|${sort}|${refreshToken}`;

  const fetchPage = useCallback(
    async (cursor: MemoriesCursor | null) => {
      const res = await listMemoriesPaged({
        data: {
          cursor,
          query: queryArg || undefined,
          kind: kindArg,
          sort,
        },
      });
      if (cursor === null && res.total !== null) {
        setFilteredCount(res.total);
      }
      return { items: res.items, nextCursor: res.nextCursor };
    },
    [queryArg, kindArg, sort],
  );

  const {
    items: memories,
    sentinelRef,
    prependItem,
    replaceItem,
    removeItem,
    done,
    loading,
  } = useInfinitePage<MemoryDto, MemoriesCursor>({
    initial: {
      items: initialState.memories,
      nextCursor: initialState.memoriesNextCursor,
    },
    fetchPage,
    resetKey,
  });

  function openMemory(entry: MemoryDto) {
    setDrawerMode("edit");
    setOpenId(entry.id);
    setForm(memoryToForm(entry));
    setError(null);
  }

  function startNew() {
    setDrawerMode("new");
    setOpenId(null);
    setForm(emptyMemoryForm);
    setError(null);
  }

  function closeDrawer() {
    setDrawerMode(null);
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
      const editing = drawerMode === "edit" && openId !== null;
      const result = await upsertMemory({
        data: {
          id: editing ? openId : undefined,
          kind: form.kind,
          title: form.title.trim(),
          body: form.body,
          validFrom: form.validFrom || null,
          validUntil: form.validUntil || null,
          evidence: form.evidence || null,
          frequency: form.frequency || null,
          importance: form.importance,
        },
      });
      if (editing) {
        replaceItem(openId, result.memory);
      } else {
        prependItem(result.memory);
      }
      setMemoriesCount(result.memoriesCount);
      setFilteredCount((count) => (filtering ? count : result.memoriesCount));
      setMostRecent(result.memoriesMostRecent);
      setRefreshToken((value) => value + 1);
      closeDrawer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save memory");
    }
  }

  async function remove(id: string) {
    const result = await deleteMemory({ data: { id } });
    if (result.removed) {
      removeItem(id);
      setMemoriesCount(result.memoriesCount);
      setFilteredCount((count) => Math.max(0, count - 1));
      setMostRecent(result.memoriesMostRecent);
      setRefreshToken((value) => value + 1);
    }
    if (openId === id) closeDrawer();
  }

  const subtitle = mostRecent
    ? `${plural(memoriesCount, "memory")} · recent: ${mostRecent.title}`
    : plural(memoriesCount, "memory");
  const showing =
    filtering || filteredCount !== memoriesCount
      ? `Showing ${filteredCount.toLocaleString()} of ${memoriesCount.toLocaleString()}`
      : `${memoriesCount.toLocaleString()} total`;
  const openMemoryEntry = openId
    ? memories.find((memory) => memory.id === openId) ?? null
    : null;

  return (
    <PageFrame eyebrow="Memory" title="Memory library" subtitle={subtitle}>
      <ThemeSync ui={initialState.settings.ui} />

      <LivenessRibbon initialRuns={initialState.memoryRuns} />

      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(18rem,1fr)_auto_auto] md:items-center">
        <label className="relative min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted-foreground))]" />
          <input
            className={cn(fieldClass, "rounded-lg pl-9")}
            placeholder="Search memories"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-2 md:contents">
          <Button type="button" onClick={startNew} className="w-full rounded-lg md:w-auto">
            <Plus className="h-4 w-4" /> New memory
          </Button>
          <MemoryViewMenu
            kind={kindFilter}
            sort={sort}
            onKindChange={setKindFilter}
            onSortChange={setSort}
          />
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-[rgb(var(--muted-foreground))]">
        <span>{showing}</span>
        {loading ? <span>Loading...</span> : null}
      </div>

      <MemoryLattice
        memories={memories}
        onOpen={openMemory}
        onStartNew={startNew}
        emptyAll={memoriesCount === 0 && memories.length === 0}
        emptyFiltered={memoriesCount > 0 && memories.length === 0 && filtering}
        filter={queryArg}
        loading={loading}
        sentinelRef={done ? null : sentinelRef}
      />

      <MemoryDrawer
        mode={drawerMode}
        form={form}
        memory={openMemoryEntry}
        error={error}
        onChange={setForm}
        onSave={save}
        onClose={closeDrawer}
        onDelete={drawerMode === "edit" && openId ? () => void remove(openId) : undefined}
      />
    </PageFrame>
  );
}

function memoryToForm(entry: MemoryDto): MemoryForm {
  return {
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    validFrom: entry.validFrom ?? "",
    validUntil: entry.validUntil ?? "",
    evidence: entry.evidence ?? "",
    frequency: entry.frequency ?? "",
    importance: entry.importance,
  };
}

function plural(value: number, noun: string): string {
  return `${value.toLocaleString()} ${value === 1 ? noun : `${noun}s`}`;
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
  sort,
  onKindChange,
  onSortChange,
}: {
  kind: MemoryKind | "all";
  sort: "recent" | "retrieved";
  onKindChange: (value: MemoryKind | "all") => void;
  onSortChange: (value: "recent" | "retrieved") => void;
}) {
  const sortItems = [
    { value: "recent" as const, label: "Recent", icon: Clock3 },
    { value: "retrieved" as const, label: "Most recalled", icon: ArrowDownWideNarrow },
  ];
  const kindItems: Array<MemoryKind | "all"> = ["all", ...MEMORY_KINDS];
  const kindLabel = kind === "all" ? "All types" : kind.replace("_", " ");
  const sortLabel = sort === "recent" ? "Recent" : "Most recalled";

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/75 px-3 text-sm text-[rgb(var(--foreground))] transition hover:bg-[rgb(var(--panel))] md:w-auto md:justify-start"
        >
          <SlidersHorizontal className="h-4 w-4 text-[rgb(var(--muted-foreground))]" />
          <span>Filters</span>
          <span className="hidden text-[rgb(var(--muted-foreground))] lg:inline">
            {kindLabel} · {sortLabel}
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
            Type
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
                  <span className="flex-1">{item === "all" ? "All types" : item.replace("_", " ")}</span>
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
