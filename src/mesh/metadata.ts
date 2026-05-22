import type { Service } from "bonjour-service";
import {
  AITHY_MESH_PROTOCOL_VERSION,
  AITHY_MESH_SERVICE_TYPE,
  type DiscoveredMeshPeer,
  type MeshPublicMetadata,
} from "./types";

export interface MeshServiceTxt {
  peerId: string;
  name?: string;
  fp?: string;
  proto?: string;
  h3?: string;
}

export function discoveredMeshPeerFromService(
  service: Service,
  now = new Date(),
): DiscoveredMeshPeer | null {
  if (service.type !== AITHY_MESH_SERVICE_TYPE) return null;
  const txt = normalizeTxt(service.txt);
  const peerId = cleanToken(txt.peerId);
  const fingerprint = cleanToken(txt.fp);
  if (!peerId || !fingerprint) return null;
  const host = bestServiceHost(service);
  if (!host || !Number.isInteger(service.port) || service.port <= 0) return null;
  return {
    peerId,
    displayName: cleanDisplay(txt.name) ?? cleanDisplay(service.name) ?? `Aithy ${peerId.slice(0, 8)}`,
    host,
    port: service.port,
    fingerprint,
    supportsHttp3: txt.h3 === "1",
    protocolVersion: cleanToken(txt.proto) ?? AITHY_MESH_PROTOCOL_VERSION,
    lastSeenAt: now.toISOString(),
    verified: false,
    warning: null,
  };
}

export function meshTxtRecord(input: MeshPublicMetadata): Record<string, string> {
  return {
    peerId: input.peerId,
    name: input.displayName,
    fp: input.fingerprint,
    proto: input.protocolVersion,
    h3: input.supportsHttp3 ? "1" : "0",
  };
}

export function safeMeshMetadata(input: MeshPublicMetadata): MeshPublicMetadata {
  return {
    peerId: cleanToken(input.peerId) ?? "",
    displayName: cleanDisplay(input.displayName) ?? "Aithy",
    port: input.port,
    fingerprint: cleanToken(input.fingerprint) ?? "",
    supportsHttp3: input.supportsHttp3 === true,
    protocolVersion: cleanToken(input.protocolVersion) ?? AITHY_MESH_PROTOCOL_VERSION,
  };
}

function normalizeTxt(value: Service["txt"]): Partial<MeshServiceTxt> {
  if (!value || typeof value !== "object") return {};
  const out: Partial<MeshServiceTxt> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const text = typeof raw === "string"
      ? raw
      : Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : raw == null
          ? ""
          : String(raw);
    if (key === "peerId") out.peerId = text;
    if (key === "name") out.name = text;
    if (key === "fp") out.fp = text;
    if (key === "proto") out.proto = text;
    if (key === "h3") out.h3 = text;
  }
  return out;
}

function bestServiceHost(service: Service): string | null {
  const addresses = Array.isArray((service as { addresses?: unknown }).addresses)
    ? (service as { addresses?: string[] }).addresses ?? []
    : [];
  const address = addresses.find((item) => isUsableAddress(item))
    ?? addresses.find((item) => typeof item === "string" && item.length > 0);
  if (address) return formatHost(address);
  if (isUsableAddress(service.host)) return formatHost(service.host);
  return null;
}

function isUsableAddress(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const host = value.trim().toLowerCase();
  return host !== "127.0.0.1" && host !== "::1" && host !== "localhost";
}

function formatHost(host: string): string {
  const trimmed = host.trim();
  return trimmed.includes(":") && !trimmed.startsWith("[") ? `[${trimmed}]` : trimmed;
}

function cleanToken(value: string | undefined): string | undefined {
  const clean = value?.trim();
  return clean ? clean.slice(0, 200) : undefined;
}

function cleanDisplay(value: string | undefined): string | undefined {
  const clean = value?.trim();
  return clean ? clean.slice(0, 80) : undefined;
}
