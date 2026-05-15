import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ArtifactPreviewKind } from "./types";

const TEXT_PREVIEW_MAX_BYTES = 64 * 1024;
const TEXT_PREVIEW_MAX_CHARS = 16_000;

const imageMimes = new Map([
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

const textMimes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jsonl", "application/x-ndjson; charset=utf-8"],
  [".log", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".ts", "text/typescript; charset=utf-8"],
  [".tsx", "text/typescript; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".yaml", "application/yaml; charset=utf-8"],
  [".yml", "application/yaml; charset=utf-8"],
]);

const binaryMimes = new Map([
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".pdf", "application/pdf"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".zip", "application/zip"],
]);

export interface ArtifactPreview {
  previewKind: ArtifactPreviewKind;
  textPreview: string | null;
}

export function mimeTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return imageMimes.get(ext)
    ?? textMimes.get(ext)
    ?? binaryMimes.get(ext)
    ?? "application/octet-stream";
}

export async function previewForFile(
  filePath: string,
  mimeType: string,
  sizeBytes: number,
): Promise<ArtifactPreview> {
  if (isCommonImage(mimeType)) return { previewKind: "image", textPreview: null };
  if (!isTextLike(mimeType) || sizeBytes > TEXT_PREVIEW_MAX_BYTES) {
    return { previewKind: "download", textPreview: null };
  }
  try {
    const bytes = await readFile(filePath);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { previewKind: "text", textPreview: truncatePreview(text) };
  } catch {
    return { previewKind: "download", textPreview: null };
  }
}

function isCommonImage(mimeType: string): boolean {
  return mimeType === "image/gif"
    || mimeType === "image/jpeg"
    || mimeType === "image/png"
    || mimeType === "image/webp";
}

function isTextLike(mimeType: string): boolean {
  return mimeType.startsWith("text/")
    || mimeType.startsWith("application/json")
    || mimeType.startsWith("application/xml")
    || mimeType.startsWith("application/yaml")
    || mimeType === "image/svg+xml";
}

function truncatePreview(text: string): string {
  if (text.length <= TEXT_PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, TEXT_PREVIEW_MAX_CHARS)}\n[truncated]`;
}
