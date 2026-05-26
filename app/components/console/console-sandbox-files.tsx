import { useState } from "react";
import { Download, FolderOpen, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { deleteSandboxFile, downloadSandboxOutboxFile, listSandboxFiles } from "@/server/console.functions";

interface SandboxFileEntry {
  path: string;
  name: string;
  kind: "file" | "directory" | "other";
  sizeBytes: number;
  modifiedAt: string | null;
}

const ROOTS = ["/workspace", "/outbox"] as const;

export function ConsoleSandboxFiles() {
  const [path, setPath] = useState<typeof ROOTS[number] | string>("/workspace");
  const [entries, setEntries] = useState<SandboxFileEntry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = rootForPath(path);

  const refresh = async (nextPath = path) => {
    setBusy(true);
    setError(null);
    try {
      const result = await listSandboxFiles({ data: { path: nextPath } });
      setSessionId(result.sessionId);
      setEntries(result.entries as SandboxFileEntry[]);
      setPath(nextPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to list sandbox files");
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (entry: SandboxFileEntry) => {
    setBusy(true);
    setError(null);
    try {
      await deleteSandboxFile({ data: { path: entry.path, recursive: entry.kind === "directory" } });
      await refresh(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete sandbox file");
      setBusy(false);
    }
  };

  const downloadEntry = async (entry: SandboxFileEntry) => {
    setBusy(true);
    setError(null);
    try {
      const file = await downloadSandboxOutboxFile({ data: { path: entry.path } });
      saveDownload(file.filename, file.mimeType, file.base64);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download sandbox file");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.44)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-4 w-4 text-[rgb(var(--accent))]" />
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-[rgb(var(--muted-foreground))]">sandbox files</span>
        </div>
        <div className="flex items-center gap-1">
          {ROOTS.map((path) => (
            <Button
              key={path}
              type="button"
              variant={root === path ? "default" : "soft"}
              size="sm"
              onClick={() => {
                void refresh(path);
              }}
            >
              {path}
            </Button>
          ))}
          {path !== root ? (
            <Button type="button" variant="soft" size="sm" onClick={() => void refresh(parentPath(path))} disabled={busy}>
              ..
            </Button>
          ) : null}
          <Button type="button" variant="soft" size="icon" aria-label="Refresh sandbox files" onClick={() => void refresh()} disabled={busy}>
            <RefreshCcw className={cn("h-4 w-4", busy && "animate-spin")} />
          </Button>
        </div>
      </div>
      <div className="mt-2 font-mono text-[10px] text-[rgb(var(--muted-foreground))]">
        {sessionId ? `session ${sessionId} :: ${path}` : "start a sandbox run to browse files"}
      </div>
      {error ? <div className="mt-2 break-words font-mono text-xs text-[rgb(var(--danger))]">{error}</div> : null}
      <div className="mt-2 max-h-56 overflow-auto rounded border border-[rgb(var(--border))]">
        {entries.length === 0 ? (
          <div className="px-3 py-5 text-center font-mono text-xs text-[rgb(var(--muted-foreground))]">
            {busy ? "loading..." : "no files loaded"}
          </div>
        ) : entries.map((entry) => (
          <div key={entry.path} className="grid grid-cols-[minmax(0,1fr)_5rem_4.5rem] items-center gap-2 border-b border-[rgb(var(--border))] px-3 py-2 last:border-b-0">
            <div className="min-w-0">
              {entry.kind === "directory" ? (
                <button
                  type="button"
                  className="block max-w-full truncate font-mono text-xs text-[rgb(var(--accent))] hover:underline"
                  onClick={() => void refresh(entry.path)}
                  disabled={busy}
                >
                  {entry.name}/
                </button>
              ) : (
                <div className="truncate font-mono text-xs">{entry.name}</div>
              )}
              <div className="truncate font-mono text-[10px] text-[rgb(var(--muted-foreground))]">{entry.path}</div>
            </div>
            <div className="text-right font-mono text-[10px] text-[rgb(var(--muted-foreground))]">{formatBytes(entry.sizeBytes)}</div>
            {entry.path.startsWith("/outbox/") ? (
              <div className="flex items-center justify-end gap-1">
                {entry.kind === "file" ? (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Download ${entry.name}`} onClick={() => void downloadEntry(entry)} disabled={busy}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${entry.name}`} onClick={() => void deleteEntry(entry)} disabled={busy}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : <span />}
          </div>
        ))}
      </div>
    </div>
  );
}

function rootForPath(path: string): typeof ROOTS[number] {
  return path.startsWith("/outbox") ? "/outbox" : "/workspace";
}

function parentPath(path: string): string {
  const root = rootForPath(path);
  if (path === root) return root;
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent && parent !== "" ? parent : root;
}

function saveDownload(filename: string, mimeType: string, base64: string): void {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
