import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { GlobalMountDto } from "@/server/dto";

const fieldClass =
  "h-11 w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 text-sm outline-none transition placeholder:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--foreground))]";

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
  const setAt = (index: number, hostPath: string) => {
    const next = mounts.slice();
    next[index] = { hostPath };
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
      subtitle="Bind-mounted into every sandbox at /workspace/mounts/<basename>-<hash>. Read-write. Folders pasted in chat are added here automatically."
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
              <div className="flex items-stretch gap-2">
                <input
                  className={cn(fieldClass, "flex-1")}
                  value={mount.hostPath}
                  placeholder="/Users/you/Documents/Obsidian-Vault"
                  spellCheck={false}
                  onChange={(event) => setAt(index, event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] text-[rgb(var(--muted-foreground))] transition hover:text-[rgb(var(--foreground))]"
                  aria-label="Remove mount"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {skipped ? (
                <p className="text-xs text-[rgb(var(--muted-foreground))]">
                  Saved, but not found on disk - skipped at sandbox start.
                </p>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => onChange([...mounts, { hostPath: "" }])}
          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed border-[rgb(var(--border))] bg-transparent text-sm text-[rgb(var(--muted-foreground))] transition hover:border-[rgb(var(--foreground))] hover:text-[rgb(var(--foreground))]"
        >
          <Plus className="h-4 w-4" /> Add path
        </button>
      </div>
    </Section>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--muted))]/30 p-5">
      <header className="grid gap-1">
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
        {subtitle ? (
          <p className="text-xs text-[rgb(var(--muted-foreground))]">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
