import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SkillDto } from "@/server/dto";

export interface SkillUploadPreview {
  bundle: {
    id: string;
    name: string;
    description: string;
    files: Array<{ path: string; content: string }>;
  };
  exists: boolean;
  existing: SkillDto | null;
  diff: {
    metadataChanged: string[];
    addedFiles: string[];
    removedFiles: string[];
    modifiedFiles: string[];
    skillMarkdownChanged: boolean;
  };
}

export function SkillUploadReview({
  preview,
  onCancel,
  onSave,
}: {
  preview: SkillUploadPreview;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
}) {
  const diff = preview.diff;
  const changed = [
    diff.skillMarkdownChanged ? "SKILL.md body" : null,
    ...diff.metadataChanged,
    ...diff.addedFiles.map((file) => `added ${file}`),
    ...diff.modifiedFiles.map((file) => `modified ${file}`),
    ...diff.removedFiles.map((file) => `removed ${file}`),
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[rgb(var(--border))] px-5 py-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
              Upload bundle
            </div>
            <h2 className="mt-1 text-xl font-medium">
              {preview.exists ? `Update ${preview.bundle.name}` : `Create ${preview.bundle.name}`}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="Cancel upload" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <p className="text-sm text-[rgb(var(--muted-foreground))]">
            {preview.bundle.id} · {preview.bundle.files.length} supporting {preview.bundle.files.length === 1 ? "file" : "files"}
          </p>
          {changed.length > 0 ? (
            <ul className="mt-4 grid gap-2 text-sm">
              {changed.map((item) => (
                <li key={item} className="rounded-md bg-[rgb(var(--muted))]/60 px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[rgb(var(--muted-foreground))]">No differences detected.</p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-[rgb(var(--border))] px-5 py-4">
          <Button type="button" variant="soft" onClick={onCancel}>Cancel</Button>
          <Button type="button" onClick={() => void onSave()}>
            {preview.exists ? "Save update" : "Create skill"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
