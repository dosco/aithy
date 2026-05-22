import { bearerToken, isLoopbackAddress } from "./http";
import { MESH_PROXY_AUTH_TOKEN } from "./types";

const MAX_MESH_REQUEST_BYTES = 8 * 1024 * 1024;
const decoder = new TextDecoder();

export function assertMeshRequestSize(req: Request): void {
  const raw = req.headers.get("content-length");
  const size = raw ? Number(raw) : 0;
  if (Number.isFinite(size) && size > MAX_MESH_REQUEST_BYTES) throw new Error("Mesh request is too large.");
}

export function assertMeshProxyRequest(req: Request, address: string | undefined | null): void {
  if (!isLoopbackAddress(address)) throw new Error("Mesh proxy is only available on loopback.");
  if (bearerToken(req) !== MESH_PROXY_AUTH_TOKEN) throw new Error("Mesh proxy authorization failed.");
}

export async function readMeshJson(req: Request): Promise<unknown> {
  assertMeshRequestSize(req);
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MESH_REQUEST_BYTES) throw new Error("Mesh request is too large.");
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(decoder.decode(bytes));
}
