import { useCallback, useState } from "react";
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
import type { MemoryKind } from "../../src/memory/types";
import { AnimatedCount } from "./mind/animated-count";
import { LivenessRibbon } from "./mind/liveness-ribbon";
import {
  KindFilterRow,
  MemoryLattice,
  NEW_MEMORY_ID,
} from "./mind/memory-lattice";
import { emptyMemoryForm, type MemoryForm } from "./mind/memory-tile";

export function MemoryPage({ initialState }: { initialState: WebStateDto }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<MemoryForm>(emptyMemoryForm);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<MemoryKind | "all">("all");
  const [memoriesCount, setMemoriesCount] = useState(initialState.memoriesCount);
  const [mostRecent, setMostRecent] = useState<{ title: string } | null>(
    initialState.memoriesMostRecent,
  );

  const debouncedFilter = useDebouncedValue(filter, 200);
  const queryArg = debouncedFilter.trim();
  const kindArg = kindFilter === "all" ? undefined : kindFilter;
  const resetKey = `${queryArg}|${kindFilter}`;

  const fetchPage = useCallback(
    async (cursor: MemoriesCursor | null) => {
      const res = await listMemoriesPaged({
        data: {
          cursor,
          query: queryArg || undefined,
          kind: kindArg,
        },
      });
      if (cursor === null && res.total !== null) {
        setMemoriesCount(res.total);
      }
      return { items: res.items, nextCursor: res.nextCursor };
    },
    [queryArg, kindArg],
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
      tags: entry.tags ?? "",
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
    try {
      const editing = openId !== null && openId !== NEW_MEMORY_ID;
      const entry = await upsertMemory({
        data: {
          id: editing ? openId : undefined,
          kind: form.kind,
          title: form.title.trim(),
          body: form.body,
          tags: form.tags.trim() || null,
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

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          className={cn(fieldClass, "max-w-xs rounded-full")}
          placeholder="filter memories…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <KindFilterRow value={kindFilter} onChange={setKindFilter} />
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
