import { describe, expect, test } from "bun:test";
import { createMeshRpcEnvelope, openMeshRpcEnvelope } from "../src/mesh/rpc";
import { createMeshCertificate } from "../src/mesh/tls-cert";

describe("mesh RPC envelopes", () => {
  test("keeps authenticated metadata and rejects replayed nonces", async () => {
    const alice = await createMeshCertificate({ peerId: "alice", displayName: "Alice" });
    const envelope = createMeshRpcEnvelope({
      senderId: "alice",
      recipientId: "bob",
      method: "health",
      payload: { ok: true },
      nonce: "nonce-1",
      privateKeyPem: alice.privateKeyPem,
    });
    const seen = new Set<string>();
    const markNonce = (_senderId: string, nonce: string) => {
      if (seen.has(nonce)) return false;
      seen.add(nonce);
      return true;
    };

    expect(openMeshRpcEnvelope<{ ok: boolean }>({
      envelope,
      localPeerId: "bob",
      remoteCertificatePem: alice.certificatePem,
      expectedSenderId: "alice",
      expectedRequestId: envelope.requestId,
      expectedMethod: "health",
      markNonce,
    })).toEqual({ ok: true });
    expect(() => openMeshRpcEnvelope({
      envelope,
      localPeerId: "bob",
      remoteCertificatePem: alice.certificatePem,
      markNonce,
    })).toThrow(/replay/);
  });

  test("rejects wrong sender, request, method, recipient, stale timestamp, or bad signature", async () => {
    const alice = await createMeshCertificate({ peerId: "alice", displayName: "Alice" });
    const mallory = await createMeshCertificate({ peerId: "mallory", displayName: "Mallory" });
    const envelope = createMeshRpcEnvelope({
      senderId: "alice",
      recipientId: "bob",
      method: "health.response",
      requestId: "request-1",
      payload: { ok: true },
      timestamp: Date.now() - 10_000,
      privateKeyPem: alice.privateKeyPem,
    });
    const base = { envelope, localPeerId: "bob", remoteCertificatePem: alice.certificatePem, maxSkewMs: 60_000 };
    expect(() => openMeshRpcEnvelope({ ...base, expectedSenderId: "mallory" })).toThrow(/sender/);
    expect(() => openMeshRpcEnvelope({ ...base, expectedRequestId: "request-2" })).toThrow(/request/);
    expect(() => openMeshRpcEnvelope({ ...base, expectedMethod: "health" })).toThrow(/method/);
    expect(() => openMeshRpcEnvelope({ envelope, localPeerId: "alice", remoteCertificatePem: alice.certificatePem })).toThrow(/recipient/);
    expect(() => openMeshRpcEnvelope({ envelope, localPeerId: "bob", remoteCertificatePem: alice.certificatePem, maxSkewMs: 1 })).toThrow(/stale/);
    expect(() => openMeshRpcEnvelope({
      ...base,
      envelope: { ...envelope, timestamp: Date.now() },
      remoteCertificatePem: mallory.certificatePem,
    })).toThrow(/signature/);
  });
});
