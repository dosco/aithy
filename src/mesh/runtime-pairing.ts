import { validateMeshHello, type MeshHelloBody } from "./http";
import { assertPairingProof, pairingProof } from "./pairing";
import type { SqliteMeshStore } from "./store";
import type { DiscoveredMeshPeer, MeshPairingWindow, MeshPeerRecord } from "./types";

export interface MeshPairResponse extends MeshHelloBody { proof: string }
export interface ActivePairing extends MeshPairingWindow { windowId: string; used: boolean; failures: number }

export async function pairWithDiscoveredMeshPeer(input: {
  peerId: string;
  code: string;
  discovered: DiscoveredMeshPeer | undefined;
  store: SqliteMeshStore;
  helloBody: () => MeshHelloBody;
  fetchHello: (host: string, port: number) => Promise<MeshHelloBody>;
  fetchUnverifiedJson: <T>(
    host: string,
    port: number,
    path: string,
    observed: { certificatePem: string; fingerprint: string },
    init?: RequestInit,
  ) => Promise<T>;
  assertHelloCertificate: (hello: MeshHelloBody) => Promise<void>;
}): Promise<MeshPeerRecord> {
  const discovered = input.discovered;
  if (!discovered) throw new Error("Mesh peer is not currently discovered.");
  const hello = await input.fetchHello(discovered.host, discovered.port);
  if (hello.peerId !== input.peerId) throw new Error("Mesh peer id changed during pairing.");
  if (hello.fingerprint !== discovered.fingerprint) throw new Error("Mesh peer fingerprint changed during pairing.");
  if (!hello.pairingWindowId) throw new Error("Mesh peer is not accepting pairings.");
  const localHello = input.helloBody();
  const responseBody = await input.fetchUnverifiedJson<MeshPairResponse>(discovered.host, discovered.port, "/mesh/pair", hello, {
    method: "POST",
    body: JSON.stringify({
      proof: await pairingProof({ code: input.code, from: localHello, to: hello, pairingWindowId: hello.pairingWindowId }),
      peer: localHello,
    }),
    headers: { "content-type": "application/json" },
  });
  const response = validateMeshHello(responseBody);
  await input.assertHelloCertificate(response);
  await assertPairingProof({
    code: input.code,
    proof: responseBody.proof,
    from: response,
    to: localHello,
    pairingWindowId: hello.pairingWindowId,
  });
  if (response.peerId !== input.peerId) throw new Error("Mesh pairing response came from a different peer.");
  if (response.fingerprint !== hello.fingerprint) throw new Error("Mesh pairing response fingerprint changed.");
  return input.store.upsertPairedPeer({
    peerId: response.peerId,
    name: response.displayName,
    host: discovered.host,
    port: discovered.port,
    certificatePem: response.certificatePem,
    fingerprint: response.fingerprint,
    supportsHttp3: response.supportsHttp3,
  });
}

export async function handleMeshPairRequest(input: {
  body: unknown;
  pairing: ActivePairing | null;
  store: SqliteMeshStore;
  helloBody: () => MeshHelloBody;
  assertHelloCertificate: (hello: MeshHelloBody) => Promise<void>;
  recordPairingFailure: () => void;
  markPairingUsed: () => void;
}): Promise<MeshPairResponse> {
  const body = input.body as { proof?: string; peer?: MeshHelloBody };
  const pairing = input.pairing;
  if (!pairing || pairing.used || Date.parse(pairing.expiresAt) <= Date.now()) throw new Error("Pairing is not open.");
  const peer = validateMeshHello(body.peer);
  await input.assertHelloCertificate(peer);
  const localHello = input.helloBody();
  try {
    await assertPairingProof({ code: pairing.code, proof: body.proof, from: peer, to: localHello, pairingWindowId: pairing.windowId });
  } catch (error) {
    input.recordPairingFailure();
    throw error;
  }
  input.store.upsertPairedPeer({
    peerId: peer.peerId,
    name: peer.displayName,
    certificatePem: peer.certificatePem,
    fingerprint: peer.fingerprint,
    supportsHttp3: peer.supportsHttp3,
  });
  input.markPairingUsed();
  return {
    ...localHello,
    proof: await pairingProof({ code: pairing.code, from: localHello, to: peer, pairingWindowId: pairing.windowId }),
  };
}
