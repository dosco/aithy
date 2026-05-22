import {
  AITHY_MESH_PROTOCOL_VERSION,
  type MeshTrustLevel,
} from "./types";
import type { MeshIdentityMaterial } from "./identity";

export interface MeshHelloBody {
  peerId: string;
  displayName: string;
  port: number;
  fingerprint: string;
  certificatePem: string;
  supportsHttp3: boolean;
  protocolVersion: string;
  pairingOpen: boolean;
  pairingWindowId: string | null;
}

export function meshPublicIdentity(identity: MeshIdentityMaterial) {
  return {
    peerId: identity.peerId,
    displayName: identity.displayName,
    fingerprint: identity.fingerprint,
    certificatePem: identity.certificatePem,
    supportsHttp3: identity.supportsHttp3,
    protocolVersion: AITHY_MESH_PROTOCOL_VERSION,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function validateMeshHello(value: unknown): MeshHelloBody {
  const body = value && typeof value === "object" ? value as Partial<MeshHelloBody> : {};
  if (!body.peerId || !body.displayName || !body.fingerprint || !body.certificatePem) {
    throw new Error("Invalid mesh hello response.");
  }
  if (body.protocolVersion && body.protocolVersion !== AITHY_MESH_PROTOCOL_VERSION) {
    throw new Error(`Unsupported mesh protocol version: ${body.protocolVersion}`);
  }
  return {
    peerId: body.peerId,
    displayName: body.displayName,
    port: Number(body.port) || 0,
    fingerprint: body.fingerprint,
    certificatePem: body.certificatePem,
    supportsHttp3: body.supportsHttp3 === true,
    protocolVersion: body.protocolVersion || AITHY_MESH_PROTOCOL_VERSION,
    pairingOpen: body.pairingOpen === true,
    pairingWindowId: typeof body.pairingWindowId === "string" ? body.pairingWindowId : null,
  };
}

export function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("authorization")?.trim();
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function trustFromPayload(value: unknown): MeshTrustLevel {
  const record = value && typeof value === "object" ? value as { trustLevel?: unknown } : {};
  return normalizeTrust(record.trustLevel);
}

export function normalizeTrust(value: unknown): MeshTrustLevel {
  if (value === "friend" || value === "family") return value;
  return "acquaintance";
}

export function viteCliPort(): number | null {
  const index = Bun.argv.indexOf("--port");
  const value = index >= 0 ? Number(Bun.argv[index + 1]) : NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function isLoopbackAddress(value: string | undefined | null): boolean {
  const address = value?.trim().toLowerCase().replace(/^::ffff:/, "");
  return Boolean(address && (address === "::1" || address === "localhost" || address.startsWith("127.")));
}
