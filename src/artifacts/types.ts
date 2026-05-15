export type ArtifactPreviewKind = "text" | "image" | "download";

export interface ArtifactEntry {
  id: string;
  sessionId: string;
  runId: string | null;
  sandboxPath: string;
  relativePath: string;
  title: string;
  description: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  previewKind: ArtifactPreviewKind;
  textPreview: string | null;
  createdAt: string;
}

export interface ArtifactPublishResult extends ArtifactEntry {
  openUrl: string;
  downloadUrl: string;
}
