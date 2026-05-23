import type { SqliteArtifactStore } from "./artifact-store";

export async function serveArtifactRequest(
  request: Request,
  artifacts: SqliteArtifactStore,
  artifactId: string,
): Promise<Response> {
  let resolved: Awaited<ReturnType<SqliteArtifactStore["resolveFile"]>>;
  try {
    resolved = await artifacts.resolveFile(artifactId);
  } catch {
    return new Response("Artifact unavailable", { status: 404 });
  }
  if (!resolved) return new Response("Artifact not found", { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const disposition = download || shouldForceDownload(resolved.entry.mimeType) ? "attachment" : "inline";
  const headers = new Headers({
    "Content-Length": String(resolved.sizeBytes),
    "Content-Type": resolved.entry.mimeType,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'unsafe-inline'",
    "Content-Disposition": `${disposition}; filename="${safeFilename(resolved.entry.filename)}"`,
  });
  return new Response(Bun.file(resolved.hostPath).stream(), {
    status: 200,
    headers,
  });
}

function safeFilename(filename: string): string {
  return filename.replaceAll(/[\x00-\x1f\x7f\\"]/g, "_") || "artifact";
}

function shouldForceDownload(mimeType: string): boolean {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return normalized === "text/javascript" || normalized === "application/javascript";
}
