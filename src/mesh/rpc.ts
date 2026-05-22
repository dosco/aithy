import { sign as signData, verify as verifyData, X509Certificate } from "node:crypto";
import type { MeshRpcEnvelope } from "./types";

export const MESH_RPC_MAX_SKEW_MS = 2 * 60_000;

export function createMeshRpcEnvelope(input: {
  senderId: string;
  recipientId: string;
  method: string;
  payload: unknown;
  requestId?: string;
  timestamp?: number;
  nonce?: string;
  privateKeyPem: string;
}): MeshRpcEnvelope {
  const envelope = {
    senderId: input.senderId,
    recipientId: input.recipientId,
    requestId: input.requestId ?? crypto.randomUUID(),
    method: input.method,
    timestamp: input.timestamp ?? Date.now(),
    nonce: input.nonce ?? randomBase64Url(16),
    payload: jsonRoundtrip(input.payload),
  };
  return {
    ...envelope,
    signature: signRpc(envelope, input.privateKeyPem),
  };
}

export function openMeshRpcEnvelope<T = unknown>(input: {
  envelope: MeshRpcEnvelope;
  localPeerId: string;
  remoteCertificatePem: string;
  expectedSenderId?: string;
  expectedRequestId?: string;
  expectedMethod?: string;
  maxSkewMs?: number;
  markNonce?: (senderId: string, nonce: string, timestamp: number) => boolean;
}): T {
  const { envelope } = input;
  if (!isMeshRpcEnvelope(envelope)) throw new Error("mesh RPC envelope is malformed");
  if (envelope.recipientId !== input.localPeerId) throw new Error("mesh RPC recipient mismatch");
  if (input.expectedSenderId && envelope.senderId !== input.expectedSenderId) {
    throw new Error("mesh RPC sender mismatch");
  }
  if (input.expectedRequestId && envelope.requestId !== input.expectedRequestId) {
    throw new Error("mesh RPC request mismatch");
  }
  if (input.expectedMethod && envelope.method !== input.expectedMethod) {
    throw new Error("mesh RPC method mismatch");
  }
  if (Math.abs(Date.now() - envelope.timestamp) > (input.maxSkewMs ?? MESH_RPC_MAX_SKEW_MS)) {
    throw new Error("mesh RPC timestamp is stale");
  }
  if (!verifyRpc(envelope, input.remoteCertificatePem)) {
    throw new Error("mesh RPC signature mismatch");
  }
  if (input.markNonce && !input.markNonce(envelope.senderId, envelope.nonce, envelope.timestamp)) {
    throw new Error("mesh RPC nonce replay");
  }
  return envelope.payload as T;
}

function isMeshRpcEnvelope(value: unknown): value is MeshRpcEnvelope {
  const envelope = value && typeof value === "object" ? value as MeshRpcEnvelope : null;
  return Boolean(
    envelope
      && typeof envelope.senderId === "string"
      && typeof envelope.recipientId === "string"
      && typeof envelope.requestId === "string"
      && typeof envelope.method === "string"
      && typeof envelope.timestamp === "number"
      && typeof envelope.nonce === "string"
      && typeof envelope.signature === "string",
  );
}

function signRpc(envelope: Omit<MeshRpcEnvelope, "signature">, privateKeyPem: string): string {
  return signData("sha256", Buffer.from(canonicalJson(envelope)), privateKeyPem).toString("base64url");
}

function verifyRpc(envelope: MeshRpcEnvelope, certificatePem: string): boolean {
  const { signature, ...unsigned } = envelope;
  try {
    return verifyData(
      "sha256",
      Buffer.from(canonicalJson(unsigned)),
      new X509Certificate(certificatePem).publicKey,
      Buffer.from(signature, "base64url"),
    );
  } catch {
    return false;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  ).join(",")}}`;
}

function jsonRoundtrip(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function randomBase64Url(byteLength: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(byteLength))).toString("base64url");
}
