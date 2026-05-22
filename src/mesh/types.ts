export const AITHY_MESH_SERVICE_TYPE = "aithy";
export const AITHY_MESH_PROTOCOL_VERSION = "2";
export const DISCOVERED_MESH_MAX_AGE_MS = 45_000;
export const MESH_HEALTHCHECK_INTERVAL_MS = 15_000;
export const MESH_PAIRING_TTL_MS = 5 * 60_000;
export const MESH_PROVIDER_PREFIX = "mesh:";
export const MESH_PROXY_AUTH_TOKEN = "aithy-mesh";

export type MeshTrustLevel = "acquaintance" | "friend" | "family";
export type MeshPresence = "online" | "offline";
export type MeshServiceKind = "inference" | "search";
export type MeshTransport = "http3" | "http2" | "http1.1";

export interface MeshIdentity {
  peerId: string;
  displayName: string;
  fingerprint: string;
  certificatePem: string;
  supportsHttp3: boolean;
  protocolVersion: string;
}

export interface MeshPublicMetadata {
  peerId: string;
  displayName: string;
  port: number;
  fingerprint: string;
  supportsHttp3: boolean;
  protocolVersion: string;
}

export interface DiscoveredMeshPeer extends MeshPublicMetadata {
  host: string;
  lastSeenAt: string;
  verified: boolean;
  warning: string | null;
}

export interface MeshServiceDescriptor {
  id: string;
  kind: MeshServiceKind;
  label: string;
  models?: MeshModelDescriptor[];
}

export interface MeshModelDescriptor {
  id: string;
  label: string;
}

export interface MeshCatalogValidation {
  status: "valid" | "not-required";
  validatedAt: string | null;
  message: string | null;
}

export interface MeshLiveInferenceService {
  id: string;
  providerId: string;
  providerLabel: string;
  slot: "primary" | "fast";
  slotLabel: string;
  models: MeshModelDescriptor[];
  validation: MeshCatalogValidation;
}

export interface MeshLiveSearchService {
  id: string;
  providerId: string;
  providerLabel: string;
  mode: "anonymous" | "api-key" | "grok-subscription";
  validation: MeshCatalogValidation;
}

export interface MeshLiveCatalog {
  inference: MeshLiveInferenceService[];
  search: MeshLiveSearchService[];
  fetchedAt: string;
}

export interface MeshLiveCatalogPeer {
  peerId: string;
  name: string;
  status: MeshPresence;
  lastSeenAt: string | null;
  lastTransport: MeshTransport | null;
  fingerprint: string;
  fetchedAt: string;
  inference: MeshLiveInferenceService[];
  search: MeshLiveSearchService[];
  error: string | null;
}

export interface MeshPeerRecord {
  peerId: string;
  name: string;
  host: string | null;
  port: number | null;
  fingerprint: string;
  certificatePem: string | null;
  supportsHttp3: boolean;
  lastTransport: MeshTransport | null;
  lastTransportErrorAt: string | null;
  trustLevel: MeshTrustLevel;
  remoteTrustLevel: MeshTrustLevel;
  status: MeshPresence;
  lastSeenAt: string | null;
  lastHealthAt: string | null;
  latencyMs: number | null;
  serviceCatalog: MeshServiceDescriptor[];
  revoked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MeshSharingSettings {
  inference: boolean;
  search: boolean;
}

export interface MeshSnapshot {
  local: MeshIdentity & {
    enabled: boolean;
    port: number | null;
    sharing: MeshSharingSettings;
    pairing: MeshPairingWindow | null;
    discoveryError: string | null;
    serverError: string | null;
  };
  discovered: DiscoveredMeshPeer[];
  paired: MeshPeerRecord[];
  inferenceProviders: MeshInferenceProvider[];
  searchProviders: MeshSearchProvider[];
}

export interface MeshPairingWindow {
  code: string;
  expiresAt: string;
}

export interface MeshInferenceProvider {
  peerId: string;
  serviceId: string;
  providerId: string;
  name: string;
  baseUrl: string;
  models: MeshModelDescriptor[];
  online: boolean;
  disabledReason: string | null;
  fingerprint: string;
  lastSeenAt: string | null;
  validation?: MeshCatalogValidation;
}

export interface MeshSearchProvider {
  peerId: string;
  serviceId: string;
  providerId: string;
  name: string;
  mode?: "anonymous" | "api-key" | "grok-subscription";
  online: boolean;
  disabledReason: string | null;
  fingerprint: string;
  lastSeenAt: string | null;
  validation?: MeshCatalogValidation;
}

export interface MeshRpcEnvelope {
  senderId: string;
  recipientId: string;
  requestId: string;
  method: string;
  timestamp: number;
  nonce: string;
  payload: unknown;
  signature: string;
}

export interface MeshRpcPayload<T = unknown> {
  value: T;
}

export function meshInferenceProviderId(peerId: string, serviceId = "default"): `mesh:${string}:inference:${string}` {
  return `${MESH_PROVIDER_PREFIX}${peerId}:inference:${serviceId}`;
}

export function meshSearchProviderId(peerId: string, serviceId = "default"): `mesh:${string}:search:${string}` {
  return `${MESH_PROVIDER_PREFIX}${peerId}:search:${serviceId}`;
}

export function isMeshProvider(provider: string | undefined | null): boolean {
  return Boolean(provider?.startsWith(MESH_PROVIDER_PREFIX));
}

export function isMeshInferenceProvider(provider: string | undefined | null): boolean {
  return parseMeshProviderId(provider)?.kind === "inference";
}

export function isMeshSearchProvider(provider: string | undefined | null): boolean {
  return parseMeshProviderId(provider)?.kind === "search";
}

export function parseMeshProviderId(provider: string | undefined | null): {
  peerId: string;
  kind: MeshServiceKind;
  serviceId: string;
} | null {
  if (!provider?.startsWith(MESH_PROVIDER_PREFIX)) return null;
  const parts = provider.slice(MESH_PROVIDER_PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  const [peerId, kind, serviceId] = parts;
  if (!peerId || (kind !== "inference" && kind !== "search") || !serviceId) return null;
  return { peerId, kind, serviceId };
}

export function mutualFamily(peer: Pick<MeshPeerRecord, "trustLevel" | "remoteTrustLevel" | "revoked">): boolean {
  return !peer.revoked && peer.trustLevel === "family" && peer.remoteTrustLevel === "family";
}
