import { Bonjour, type Browser, type Service } from "bonjour-service";
import { meshPublicIdentity, type MeshHelloBody } from "./http";
import type { MeshIdentityMaterial } from "./identity";
import { discoveredMeshPeerFromService, meshTxtRecord, safeMeshMetadata } from "./metadata";
import {
  AITHY_MESH_SERVICE_TYPE,
  DISCOVERED_MESH_MAX_AGE_MS,
  type DiscoveredMeshPeer,
} from "./types";

export function startMeshDiscovery(input: {
  onUp: (service: Service) => void;
  onDown: (service: Service) => void;
  onError: (message: string) => void;
}): { bonjour: Bonjour | null; browser: Browser | null; error: string | null } {
  try {
    const bonjour = new Bonjour(undefined, (error: unknown) => input.onError(describeDiscoveryError(error)));
    const browser = bonjour.find({ type: AITHY_MESH_SERVICE_TYPE });
    browser.on("up", input.onUp);
    browser.on("txt-update", input.onUp);
    browser.on("down", input.onDown);
    return { bonjour, browser, error: null };
  } catch (error) {
    return { bonjour: null, browser: null, error: describeDiscoveryError(error) };
  }
}

export function publishMeshService(input: {
  bonjour: Bonjour | null;
  current: Service | null;
  identity: MeshIdentityMaterial;
  port: number | null;
  supportsHttp3: boolean;
}): Service | null {
  if (!input.bonjour || !input.port) return input.current;
  input.current?.stop?.();
  const metadata = safeMeshMetadata({
    ...meshPublicIdentity(input.identity),
    supportsHttp3: input.supportsHttp3,
    port: input.port,
  });
  return input.bonjour.publish({
    name: metadata.displayName,
    type: AITHY_MESH_SERVICE_TYPE,
    port: metadata.port,
    txt: meshTxtRecord(metadata),
  });
}

export function upsertDiscoveredMeshPeer(input: {
  service: Service;
  discovered: Map<string, DiscoveredMeshPeer>;
  localPeerId: string | undefined;
  verify: (peer: DiscoveredMeshPeer) => Promise<void>;
}): void {
  const peer = discoveredMeshPeerFromService(input.service);
  if (!peer || peer.peerId === input.localPeerId) return;
  const duplicate = [...input.discovered.values()].find((item) =>
    (item.peerId === peer.peerId && item.fingerprint !== peer.fingerprint)
    || (item.peerId !== peer.peerId && item.fingerprint === peer.fingerprint)
  );
  if (duplicate) {
    input.discovered.set(peer.peerId, {
      ...peer,
      warning: "Duplicate mesh identity metadata seen on this LAN.",
    });
    return;
  }
  input.discovered.set(peer.peerId, peer);
  void input.verify(peer).catch(() => undefined);
}

export function removeDiscoveredMeshPeer(
  discovered: Map<string, DiscoveredMeshPeer>,
  service: Service,
): void {
  const peer = discoveredMeshPeerFromService(service);
  if (peer) discovered.delete(peer.peerId);
}

export function pruneDiscoveredPeers(discovered: Map<string, DiscoveredMeshPeer>, now: Date): void {
  const cutoff = now.getTime() - DISCOVERED_MESH_MAX_AGE_MS;
  for (const [id, peer] of discovered) {
    if (Date.parse(peer.lastSeenAt) < cutoff) discovered.delete(id);
  }
}

export async function verifyDiscoveredMeshPeer(input: {
  peer: DiscoveredMeshPeer;
  discovered: Map<string, DiscoveredMeshPeer>;
  fetchHello: (host: string, port: number) => Promise<MeshHelloBody>;
}): Promise<void> {
  const hello = await input.fetchHello(input.peer.host, input.peer.port);
  const current = input.discovered.get(input.peer.peerId);
  if (!current || current.host !== input.peer.host || current.port !== input.peer.port) return;
  if (hello.peerId !== input.peer.peerId || hello.fingerprint !== input.peer.fingerprint) {
    input.discovered.set(input.peer.peerId, { ...current, verified: false, warning: "Mesh hello did not match mDNS." });
    return;
  }
  input.discovered.set(input.peer.peerId, {
    ...current,
    displayName: hello.displayName,
    supportsHttp3: hello.supportsHttp3,
    verified: true,
    warning: null,
  });
}

function describeDiscoveryError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
