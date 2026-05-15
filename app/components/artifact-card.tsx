import { useState } from "react";
import {
  Check,
  ChevronDown,
  Clipboard,
  Download,
  ExternalLink,
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
} from "lucide-react";
import type { SerializableBotMessage } from "../../src/web/live-events";

type ArtifactMessage = Extract<SerializableBotMessage, { kind: "artifact" }>;

export function ArtifactCard({ artifact }: { artifact: ArtifactMessage }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const Icon = iconForArtifact(artifact);
  const detailsId = `artifact-details-${artifact.id}`;
  const hasPreview = canPreviewArtifact(artifact);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(artifact.sandboxPath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="app-chat-bubble-frame w-fit max-w-[min(72%,36rem)] overflow-hidden rounded-[18px] border border-[rgb(var(--border))] bg-[rgb(var(--panel))] text-sm shadow-[0_14px_30px_rgba(24,24,27,0.08)]">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[rgb(var(--muted))] text-[rgb(var(--muted-foreground))]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
                artifact
              </div>
              <div className="mt-1 truncate text-base font-medium leading-6">{artifact.title}</div>
              {artifact.description ? (
                <div className="mt-0.5 truncate leading-5 text-[rgb(var(--muted-foreground))]">{artifact.description}</div>
              ) : null}
              <div className="mt-1 truncate font-mono text-[11px] text-[rgb(var(--muted-foreground))]">
                {artifact.filename} · {formatBytes(artifact.sizeBytes)}
              </div>
            </div>
            <div className="-mr-1 flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={copied ? "Path copied" : "Copy artifact path"}
                title={copied ? "Path copied" : "Copy artifact path"}
                className="grid h-8 w-8 place-items-center rounded-full text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]"
                onClick={copyPath}
              >
                {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
              </button>
              {hasPreview ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  aria-label={expanded ? "Collapse artifact preview" : "Expand artifact preview"}
                  title={expanded ? "Collapse artifact preview" : "Expand artifact preview"}
                  className="grid h-8 w-8 place-items-center rounded-full text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]"
                  onClick={() => setExpanded((value) => !value)}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <a
              href={artifact.openUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center justify-center gap-2 rounded-full border border-[rgb(var(--border))] px-3 transition hover:bg-[rgb(var(--muted))]"
            >
              <ExternalLink className="h-4 w-4" /> Open
            </a>
            <a
              href={artifact.downloadUrl}
              className="inline-flex h-8 items-center justify-center gap-2 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--foreground))] px-3 text-[rgb(var(--background))] transition hover:opacity-90"
            >
              <Download className="h-4 w-4" /> Download
            </a>
          </div>
        </div>
      </div>

      {expanded && hasPreview ? <ArtifactPreview artifact={artifact} detailsId={detailsId} /> : null}
    </div>
  );
}

function ArtifactPreview({ artifact, detailsId }: { artifact: ArtifactMessage; detailsId: string }) {
  if (artifact.previewKind === "image") {
    return (
      <div id={detailsId} className="border-t border-[rgb(var(--border))] bg-[rgb(var(--background)/0.42)] px-4 py-3">
        <img
          src={artifact.openUrl}
          alt={artifact.title}
          className="max-h-56 max-w-full rounded-md border border-[rgb(var(--border))] object-contain"
        />
      </div>
    );
  }
  if (artifact.previewKind === "text" && artifact.textPreview) {
    return (
      <pre id={detailsId} className="max-h-36 overflow-auto border-t border-[rgb(var(--border))] bg-[rgb(var(--background)/0.58)] px-4 py-3 font-mono text-xs leading-5 text-[rgb(var(--foreground))] whitespace-pre-wrap">
        {artifact.textPreview}
      </pre>
    );
  }
  if (artifact.mimeType.startsWith("video/")) {
    return (
      <div id={detailsId} className="border-t border-[rgb(var(--border))] bg-[rgb(var(--background)/0.42)] px-4 py-3">
        <video controls className="max-h-56 max-w-full rounded-md border border-[rgb(var(--border))]">
          <source src={artifact.openUrl} type={artifact.mimeType} />
        </video>
      </div>
    );
  }
  if (artifact.mimeType.startsWith("audio/")) {
    return (
      <div id={detailsId} className="border-t border-[rgb(var(--border))] bg-[rgb(var(--background)/0.42)] px-4 py-3">
        <audio controls className="w-full max-w-md">
          <source src={artifact.openUrl} type={artifact.mimeType} />
        </audio>
      </div>
    );
  }
  return null;
}

function iconForArtifact(artifact: ArtifactMessage) {
  if (artifact.previewKind === "image") return ImageIcon;
  if (artifact.mimeType.startsWith("video/")) return FileVideo;
  if (artifact.mimeType.startsWith("audio/")) return FileAudio;
  return FileText;
}

function canPreviewArtifact(artifact: ArtifactMessage): boolean {
  if (artifact.previewKind === "text") return Boolean(artifact.textPreview);
  if (artifact.previewKind === "image") return true;
  return artifact.mimeType.startsWith("video/") || artifact.mimeType.startsWith("audio/");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
