import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { meshProxyUrlFromState } from "../src/mesh/proxy-url";
import { SqliteMeshStore } from "../src/mesh/store";
import { mutualFamily } from "../src/mesh/types";

describe("mesh store", () => {
  test("tracks trust transitions without caching remote service catalogs", async () => {
    const store = new SqliteMeshStore(await tempDbPath());
    try {
      store.upsertPairedPeer({
        peerId: "peer-1",
        name: "Studio",
        certificatePem: "cert-1",
        fingerprint: "fp",
        supportsHttp3: true,
      });
      let peer = store.requirePeer("peer-1");
      expect(peer.trustLevel).toBe("acquaintance");
      expect(mutualFamily(peer)).toBe(false);

      peer = store.setTrustLevel("peer-1", "family");
      expect(mutualFamily(peer)).toBe(false);
      peer = store.updatePresence("peer-1", {
        status: "online",
        remoteTrustLevel: "family",
        serviceCatalog: [{ id: "default", kind: "inference", label: "Inference" }],
      })!;

      expect(mutualFamily(peer)).toBe(true);
      expect(peer.serviceCatalog).toEqual([]);
      expect(store.revokePeer("peer-1").revoked).toBe(true);
      peer = store.upsertPairedPeer({
        peerId: "peer-1",
        name: "GPU",
        certificatePem: "cert-2",
        fingerprint: "fp2",
        supportsHttp3: false,
      });
      expect(peer.revoked).toBe(false);
      expect(peer.trustLevel).toBe("acquaintance");
      expect(peer.remoteTrustLevel).toBe("acquaintance");
      expect(peer.serviceCatalog).toEqual([]);
      expect(peer.certificatePem).toBe("cert-2");
      expect(peer.supportsHttp3).toBe(false);
    } finally {
      store.close();
    }
  });

  test("rejects replayed nonces", async () => {
    const store = new SqliteMeshStore(await tempDbPath());
    try {
      expect(store.markNonce("peer-1", "nonce-1", Date.now())).toBe(true);
      expect(store.markNonce("peer-1", "nonce-1", Date.now())).toBe(false);
    } finally {
      store.close();
    }
  });

  test("persists mesh enablement and marks peers offline", async () => {
    const dbPath = await tempDbPath();
    const store = new SqliteMeshStore(dbPath);
    try {
      expect(store.meshEnabled()).toBe(true);
      expect(store.saveMeshEnabled(false)).toBe(false);
      expect(store.meshEnabled()).toBe(false);
      expect(store.saveMeshEnabled(true)).toBe(true);
      expect(store.meshEnabled()).toBe(true);

      store.upsertPairedPeer({
        peerId: "peer-1",
        name: "Studio",
        certificatePem: "cert-1",
        fingerprint: "fp",
        supportsHttp3: true,
      });
      store.updatePresence("peer-1", {
        status: "online",
        latencyMs: 12,
        serviceCatalog: [{ id: "default", kind: "inference", label: "Inference" }],
      });
      store.markAllOffline();

      const peer = store.requirePeer("peer-1");
      expect(peer.status).toBe("offline");
      expect(peer.latencyMs).toBeNull();
      expect(peer.serviceCatalog).toEqual([]);
      store.saveProxyPort(49321);
      expect(meshProxyUrlFromState(dbPath, "mesh:peer-1:inference:default")).toContain(":49321/mesh/proxy/");
      store.saveMeshEnabled(false);
      expect(meshProxyUrlFromState(dbPath, "mesh:peer-1:inference:default")).toBeUndefined();
    } finally {
      store.close();
    }
  });
});

async function tempDbPath(): Promise<string> {
  return path.join(await mkdtemp(path.join(tmpdir(), "aithy-mesh-")), "state.db");
}
