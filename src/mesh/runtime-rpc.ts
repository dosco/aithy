import type { AppConfig } from "../config/env";
import type { RuntimeStore } from "../runtime/runtime-store";
import { webSearch } from "../search/web-search-provider";
import { handleMeshOpenAiProxy } from "./openai-proxy";
import { normalizeTrust, trustFromPayload, type MeshHelloBody } from "./http";
import { createMeshRpcEnvelope, openMeshRpcEnvelope } from "./rpc";
import type { SqliteMeshStore } from "./store";
import type { MeshFetchResult } from "./transport";
import {
  mutualFamily,
  type DiscoveredMeshPeer,
  type MeshLiveCatalog,
  type MeshPeerRecord,
  type MeshRpcEnvelope,
  type MeshTrustLevel,
} from "./types";

export interface MeshRpcRuntimeDeps {
  store: SqliteMeshStore;
  localPeerId: () => string;
  localPrivateKeyPem: () => string;
  config: () => AppConfig;
  runtimeStore: () => RuntimeStore;
  localCatalog: () => Promise<MeshLiveCatalog>;
  resolveInferenceService: (serviceId: string, model?: string | null) => Promise<AppConfig>;
  resolveSearchService: (serviceId: string) => Promise<AppConfig>;
  discoveredPeer: (peerId: string) => DiscoveredMeshPeer | undefined;
  fetchHello: (host: string, port: number, peer?: MeshPeerRecord) => Promise<MeshHelloBody>;
  fetchPinnedJson: <T>(peer: MeshPeerRecord, path: string, init?: RequestInit) => Promise<MeshFetchResult<T>>;
}

export async function handleMeshRpc(input: unknown, deps: MeshRpcRuntimeDeps): Promise<MeshRpcEnvelope> {
  const envelope = input as MeshRpcEnvelope;
  const peer = deps.store.peer(envelope.senderId);
  if (!peer || peer.revoked) throw new Error("Unknown or revoked mesh peer.");
  if (!peer.certificatePem) throw new Error("Mesh peer must be re-paired for authenticated RPC.");
  const payload = openMeshRpcEnvelope({
    envelope,
    localPeerId: deps.localPeerId(),
    remoteCertificatePem: peer.certificatePem,
    expectedSenderId: peer.peerId,
    markNonce: (senderId, nonce, timestamp) => deps.store.markNonce(senderId, nonce, timestamp),
  });
  const result = await dispatchMeshRpc(peer, envelope.method, payload, deps);
  return createMeshRpcEnvelope({
    senderId: deps.localPeerId(),
    recipientId: peer.peerId,
    method: `${envelope.method}.response`,
    requestId: envelope.requestId,
    payload: result,
    privateKeyPem: deps.localPrivateKeyPem(),
  });
}

export async function callMeshPeer(
  peer: MeshPeerRecord,
  method: string,
  payload: unknown,
  deps: MeshRpcRuntimeDeps,
): Promise<unknown> {
  return (await callMeshPeerWithTransport(peer, method, payload, deps)).value;
}

export async function callMeshPeerWithTransport(
  peer: MeshPeerRecord,
  method: string,
  payload: unknown,
  deps: MeshRpcRuntimeDeps,
): Promise<MeshFetchResult<unknown>> {
  if (!peer.host || !peer.port) throw new Error("Mesh peer is offline.");
  if (!peer.certificatePem) throw new Error("Mesh peer must be re-paired for pinned TLS.");
  const envelope = createMeshRpcEnvelope({
    senderId: deps.localPeerId(),
    recipientId: peer.peerId,
    method,
    payload,
    privateKeyPem: deps.localPrivateKeyPem(),
  });
  const response = await deps.fetchPinnedJson<MeshRpcEnvelope>(peer, "/mesh/rpc", {
    method: "POST",
    body: JSON.stringify(envelope),
    headers: { "content-type": "application/json" },
  });
  return {
    transport: response.transport,
    value: openMeshRpcEnvelope({
      envelope: response.value,
      localPeerId: deps.localPeerId(),
      remoteCertificatePem: peer.certificatePem,
      expectedSenderId: peer.peerId,
      expectedRequestId: envelope.requestId,
      expectedMethod: `${method}.response`,
      markNonce: (senderId, nonce, timestamp) => deps.store.markNonce(senderId, nonce, timestamp),
    }),
  };
}

export async function healthcheckMeshPeers(deps: MeshRpcRuntimeDeps): Promise<void> {
  for (const peer of deps.store.peers()) {
    if (peer.revoked) continue;
    const discovered = deps.discoveredPeer(peer.peerId);
    const host = discovered?.host ?? peer.host;
    const port = discovered?.port ?? peer.port;
    if (!host || !port) {
      deps.store.updatePresence(peer.peerId, { status: "offline" });
      continue;
    }
    const started = performance.now();
    try {
      const hello = await deps.fetchHello(host, port, peer);
      if (hello.fingerprint !== peer.fingerprint) throw new Error("fingerprint mismatch");
      const call = await callMeshPeerWithTransport({ ...peer, host, port }, "health", { trustLevel: peer.trustLevel }, deps);
      const result = call.value as { trustLevel?: MeshTrustLevel };
      deps.store.updatePresence(peer.peerId, {
        host,
        port,
        status: "online",
        latencyMs: Math.round(performance.now() - started),
        supportsHttp3: hello.supportsHttp3,
        lastTransport: call.transport,
        lastTransportErrorAt: null,
        remoteTrustLevel: normalizeTrust(result.trustLevel),
      });
    } catch {
      deps.store.updatePresence(peer.peerId, {
        status: "offline",
        lastTransportErrorAt: new Date().toISOString(),
      });
    }
  }
}

export function requireCallablePeer(
  store: SqliteMeshStore,
  peerId: string,
  _kind: "inference" | "search",
  _serviceId: string,
): MeshPeerRecord {
  const peer = store.requirePeer(peerId);
  assertFamilyPeer(peer);
  return peer;
}

export function assertInboundService(
  peer: MeshPeerRecord,
): void {
  if (!mutualFamily(peer)) throw new Error("Mesh service requires mutual family trust.");
}

async function dispatchMeshRpc(
  peer: MeshPeerRecord,
  method: string,
  payload: unknown,
  deps: MeshRpcRuntimeDeps,
): Promise<unknown> {
  if (method === "health") {
    deps.store.updatePresence(peer.peerId, {
      status: "online",
      remoteTrustLevel: trustFromPayload(payload),
    });
    return { trustLevel: peer.trustLevel };
  }
  if (method === "catalog.list") {
    assertInboundService(peer);
    return deps.localCatalog();
  }
  if (method === "revoke") {
    deps.store.revokePeer(peer.peerId);
    return { ok: true };
  }
  if (method === "unpair") {
    deps.store.unpairPeer(peer.peerId);
    return { ok: true };
  }
  if (method === "search.query") {
    assertInboundService(peer);
    const request = payload as { serviceId?: string; input?: unknown };
    if (!request.serviceId) throw new Error("Mesh search request is missing service id.");
    const config = await deps.resolveSearchService(request.serviceId);
    return webSearch(request.input as never, config);
  }
  if (method === "inference.openai") {
    assertInboundService(peer);
    const request = payload as { serviceId?: string; path?: string; body?: unknown };
    if (!request.serviceId) throw new Error("Mesh inference request is missing service id.");
    const config = await deps.resolveInferenceService(request.serviceId, requestedModel(request.body));
    return handleMeshOpenAiProxy(request.path ?? "", request.body, {
      config,
      runtimeStore: deps.runtimeStore(),
    });
  }
  throw new Error(`Unsupported mesh RPC method: ${method}`);
}

function assertFamilyPeer(peer: MeshPeerRecord): void {
  if (!mutualFamily(peer)) throw new Error("Mesh service requires mutual family trust.");
  if (peer.status !== "online") throw new Error("Mesh peer is offline.");
}

function requestedModel(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const model = (body as Record<string, unknown>).model;
  return typeof model === "string" ? model : null;
}
