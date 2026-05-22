import {
  isMeshInferenceProvider,
  isMeshSearchProvider,
  mutualFamily,
  parseMeshProviderId,
  type MeshLiveCatalog,
  type MeshLiveCatalogPeer,
  type MeshPeerRecord,
} from "./types";

export type MeshPeerCall = (peer: MeshPeerRecord, method: string, payload: unknown) => Promise<unknown>;

export async function liveCatalogPeer(
  peer: MeshPeerRecord,
  kind: "inference" | "search" | "all",
  callPeer: MeshPeerCall,
): Promise<MeshLiveCatalogPeer> {
  const base = {
    peerId: peer.peerId,
    name: peer.name,
    status: peer.status,
    lastSeenAt: peer.lastSeenAt,
    lastTransport: peer.lastTransport,
    fingerprint: peer.fingerprint,
    fetchedAt: new Date().toISOString(),
  };
  if (peer.status !== "online") return { ...base, inference: [], search: [], error: "offline" };
  try {
    const catalog = await callPeer(peer, "catalog.list", {}) as MeshLiveCatalog;
    return {
      ...base,
      inference: kind === "search" ? [] : catalog.inference,
      search: kind === "inference" ? [] : catalog.search,
      error: null,
    };
  } catch (error) {
    return { ...base, inference: [], search: [], error: error instanceof Error ? error.message : "catalog unavailable" };
  }
}

export async function liveCatalogPeers(
  peers: MeshPeerRecord[],
  kind: "inference" | "search" | "all",
  callPeer: MeshPeerCall,
): Promise<MeshLiveCatalogPeer[]> {
  const rows: MeshLiveCatalogPeer[] = [];
  for (const peer of peers.filter((item) => mutualFamily(item))) rows.push(await liveCatalogPeer(peer, kind, callPeer));
  return rows;
}

export async function validateMeshInferenceSelection(input: {
  providerId: string;
  model: string;
  requirePeer: (peerId: string, kind: "inference", serviceId: string) => MeshPeerRecord;
  callPeer: MeshPeerCall;
}): Promise<void> {
  const parsed = parseMeshProviderId(input.providerId);
  if (!parsed || !isMeshInferenceProvider(input.providerId)) throw new Error("Invalid family inference provider.");
  const peer = input.requirePeer(parsed.peerId, "inference", parsed.serviceId);
  const catalog = await input.callPeer(peer, "catalog.list", {}) as MeshLiveCatalog;
  const service = catalog.inference.find((item) => item.id === parsed.serviceId);
  if (!service) throw new Error("Selected family inference service is not currently offered.");
  if (!service.models.some((item) => item.id === input.model)) throw new Error("Selected model is not offered by that family service.");
}

export async function validateMeshSearchSelection(input: {
  providerId: string;
  requirePeer: (peerId: string, kind: "search", serviceId: string) => MeshPeerRecord;
  callPeer: MeshPeerCall;
}): Promise<void> {
  const parsed = parseMeshProviderId(input.providerId);
  if (!parsed || !isMeshSearchProvider(input.providerId)) throw new Error("Invalid family search provider.");
  const peer = input.requirePeer(parsed.peerId, "search", parsed.serviceId);
  const catalog = await input.callPeer(peer, "catalog.list", {}) as MeshLiveCatalog;
  if (!catalog.search.some((item) => item.id === parsed.serviceId)) {
    throw new Error("Selected family search service is not currently offered.");
  }
}
