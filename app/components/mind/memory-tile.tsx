import { motion } from "framer-motion";
import { CalendarDays, Quote, Repeat2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MemoryDto } from "@/server/dto";
import type { MemoryKind } from "../../../src/memory/types";
import { KIND_TINT_BORDER, KindGlyph } from "./kind-glyph";

export interface MemoryForm {
  kind: MemoryKind;
  title: string;
  body: string;
  validFrom: string;
  validUntil: string;
  evidence: string;
  frequency: string;
  importance: number;
}

export const emptyMemoryForm: MemoryForm = {
  kind: "fact",
  title: "",
  body: "",
  validFrom: "",
  validUntil: "",
  evidence: "",
  frequency: "",
  importance: 0.5,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function isFresh(entry: MemoryDto): boolean {
  if (!entry.lastRecalledAt || entry.retrievedCount === 0) return false;
  return Date.now() - Date.parse(entry.lastRecalledAt) < 24 * 3_600_000;
}

function isStale(entry: MemoryDto): boolean {
  const ref = entry.lastRecalledAt ?? entry.updatedAt;
  return Date.now() - Date.parse(ref) > 14 * 86_400_000;
}

export function MemoryTile({
  entry,
  onOpen,
  breathing,
}: {
  entry: MemoryDto;
  onOpen: () => void;
  breathing: boolean;
}) {
  const fresh = isFresh(entry);
  const stale = isStale(entry);
  const metadata = memoryMetadata(entry);
  const recallLabel = memoryRecallLabel(entry);

  return (
    <motion.li layout transition={{ type: "spring", stiffness: 360, damping: 32 }}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group relative flex h-full min-h-[164px] w-full flex-col overflow-hidden rounded-lg border bg-[rgb(var(--panel))] p-3 text-left shadow-sm shadow-black/5 transition sm:p-4",
          "hover:-translate-y-0.5 hover:border-[rgb(var(--foreground))]/30 hover:shadow-md motion-reduce:hover:translate-y-0",
          KIND_TINT_BORDER[entry.kind],
          stale && "opacity-85",
        )}
      >
        {fresh ? <span aria-hidden className={cn("absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-[rgb(var(--foreground))]", breathing && "mind-breath")} /> : null}
        <div className="min-w-0 pr-5">
          <KindGlyph kind={entry.kind} className="rounded-full bg-[rgb(var(--muted))]/60 px-2 py-0.5" />
          <h3 className="mt-3 truncate text-base font-medium leading-snug sm:text-lg">{entry.title}</h3>
        </div>

        {metadata.length > 0 ? (
          <div className="mt-3 flex min-w-0 flex-wrap gap-1.5">
            {metadata.slice(0, 2).map((item) => (
              <span
                key={item.key}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-[rgb(var(--muted))]/70 px-2 py-0.5 text-[11px] text-[rgb(var(--muted-foreground))]"
                title={item.title}
              >
                <item.icon className="h-3 w-3 shrink-0" />
                <span className="truncate">{item.text}</span>
              </span>
            ))}
          </div>
        ) : null}

        <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm leading-5 text-[rgb(var(--muted-foreground))]">
          {entry.body}
        </p>

        <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-3 text-[11px] text-[rgb(var(--muted-foreground))]">
          <span>
            {entry.lastRecalledAt
              ? `last recalled ${relativeTime(entry.lastRecalledAt)}`
              : `updated ${relativeTime(entry.updatedAt)}`}
          </span>
          <span>{recallLabel}</span>
        </div>
      </button>
    </motion.li>
  );
}

function memoryRecallLabel(entry: MemoryDto): string {
  if (entry.retrievedCount <= 0) return "not recalled yet";
  return `recalled ${entry.retrievedCount}x`;
}

function memoryMetadata(entry: MemoryDto): Array<{
  key: string;
  text: string;
  title: string;
  icon: typeof CalendarDays;
}> {
  const items: Array<{ key: string; text: string; title: string; icon: typeof CalendarDays }> = [];
  if (entry.validFrom || entry.validUntil) {
    items.push({
      key: "valid",
      text: validLabel(entry),
      title: durationTitle(entry),
      icon: CalendarDays,
    });
  }
  if (entry.frequency) {
    items.push({ key: "frequency", text: entry.frequency, title: `frequency: ${entry.frequency}`, icon: Repeat2 });
  }
  if (entry.evidence) {
    items.push({ key: "evidence", text: entry.evidence, title: `evidence: ${entry.evidence}`, icon: Quote });
  }
  return items;
}

function validLabel(entry: MemoryDto): string {
  if (entry.validFrom && entry.validUntil) return `${shortDate(entry.validFrom)}-${shortDate(entry.validUntil)}`;
  if (entry.validFrom) return `from ${shortDate(entry.validFrom)}`;
  return `until ${shortDate(entry.validUntil!)}`;
}

function durationTitle(entry: MemoryDto): string {
  const base = `valid: ${entry.validFrom ?? "unknown"} to ${entry.validUntil ?? "unknown"}`;
  return entry.durationDays !== null ? `${base} (${entry.durationDays}d)` : base;
}

function shortDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${month}/${day}`;
}
