import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function ConsoleFilters({
  query,
  onQueryChange,
  queryPlaceholder,
  selectLabel,
  selectValue,
  onSelectChange,
  options,
  count,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  queryPlaceholder: string;
  selectLabel: string;
  selectValue: string;
  onSelectChange: (value: string) => void;
  options: string[];
  count: string;
}) {
  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted-foreground))]" />
        <Input
          className="h-10 rounded-lg bg-[rgb(var(--panel)/0.74)] pl-9 font-mono text-xs"
          placeholder={queryPlaceholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <label className="flex h-10 items-center gap-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.74)] px-3 font-mono text-xs text-[rgb(var(--muted-foreground))]">
        {selectLabel}
        <select
          className="bg-transparent text-[rgb(var(--foreground))] outline-none"
          value={selectValue}
          onChange={(event) => onSelectChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <div className="flex h-10 items-center rounded-lg border border-[rgb(var(--border))] px-3 font-mono text-xs text-[rgb(var(--muted-foreground))]">
        {count}
      </div>
    </div>
  );
}

export function LoadMoreRow({
  hasMore,
  label,
  onLoadMore,
}: {
  hasMore: boolean;
  label: string;
  onLoadMore: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hasMore || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) onLoadMore();
    }, { rootMargin: "260px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  return (
    <div ref={ref} className="px-3 py-3 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-[rgb(var(--muted-foreground))]">
      {label}
    </div>
  );
}
