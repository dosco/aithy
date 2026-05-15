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
  const headers = new Headers({
    "Content-Length": String(resolved.sizeBytes),
    "Content-Type": resolved.entry.mimeType,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeFilename(resolved.entry.filename)}"`,
  });
  return new Response(Bun.file(resolved.hostPath).stream(), {
    status: 200,
    headers,
  });
}

function safeFilename(filename: string): string {
  return filename.replaceAll(/[\\"]/g, "_");
}
