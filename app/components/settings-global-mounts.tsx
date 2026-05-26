import { Plus, X } from "lucide-react";
import { Section, fieldClass, selectClass } from "@/components/settings-form-bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GlobalMountDto } from "@/server/dto";

export function GlobalMountsSection({
  mounts,
  skippedPaths,
  onChange,
}: {
  mounts: GlobalMountDto[];
  skippedPaths: string[];
  onChange: (next: GlobalMountDto[]) => void;
}) {
  const skippedSet = new Set(skippedPaths);
  const setAt = (index: number, patch: Partial<GlobalMountDto>) => {
    const next = mounts.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };
  const removeAt = (index: number) => {
    const next = mounts.slice();
    next.splice(index, 1);
    onChange(next);
  };
  return (
    <Section
      title="Global mounts"
      subtitle="Bind-mounted into every sandbox at /mounts/<name>. Read-only by default. Folders pasted in chat are added here automatically."
      muted
    >
      <div className="grid gap-2">
        {mounts.length === 0 ? (
          <p className="text-xs text-[rgb(var(--muted-foreground))]">
            No global mounts. Add a folder path like <code>/Users/you/Documents</code> or paste one in chat.
          </p>
        ) : null}
        {mounts.map((mount, index) => {
          const trimmed = mount.hostPath.trim();
          const skipped = trimmed && skippedSet.has(trimmed);
          return (
            <div key={index} className="grid gap-1">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_9rem_auto]">
                <input
                  className={cn(fieldClass, "flex-1")}
                  value={mount.hostPath}
                  placeholder="/Users/you/Documents/Obsidian-Vault"
                  spellCheck={false}
                  onChange={(event) => setAt(index, { hostPath: event.target.value })}
                />
                <select
                  className={selectClass}
                  value={mount.mode ?? "read-only"}
                  aria-label="Mount mode"
                  onChange={(event) => setAt(index, { mode: event.target.value === "read-write" ? "read-write" : "read-only" })}
                >
                  <option value="read-only">read-only</option>
                  <option value="read-write">read-write</option>
                </select>
                <Button
                  type="button"
                  onClick={() => removeAt(index)}
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))]"
                  aria-label="Remove mount"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {skipped ? (
                <p className="text-xs text-[rgb(var(--muted-foreground))]">
                  Saved, but not found on disk - skipped at sandbox start.
                </p>
              ) : null}
            </div>
          );
        })}
        <Button
          type="button"
          onClick={() => onChange([...mounts, { hostPath: "", mode: "read-only" }])}
          variant="ghost"
          className="h-11 w-full rounded-xl border border-dashed border-[rgb(var(--border))] bg-transparent hover:border-[rgb(var(--foreground))]"
        >
          <Plus className="h-4 w-4" /> Add path
        </Button>
      </div>
    </Section>
  );
}
