import type { MeshHelloBody } from "./http";

const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const encoder = new TextEncoder();

export interface MeshPairProofInput {
  code: string;
  from: Pick<MeshHelloBody, "peerId" | "fingerprint" | "protocolVersion">;
  to: Pick<MeshHelloBody, "peerId" | "fingerprint" | "protocolVersion">;
  pairingWindowId: string;
}

export function generatePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12)}`;
}

export async function pairingProof(input: MeshPairProofInput): Promise<string> {
  const code = normalizedPairingCode(input.code);
  if (!code) throw new Error("Pairing code is empty.");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(code),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(pairingMessage(input)));
  return Buffer.from(signature).toString("base64url");
}

export async function assertPairingProof(input: MeshPairProofInput & { proof?: string }): Promise<void> {
  const expected = await pairingProof(input);
  const proof = input.proof?.trim() ?? "";
  if (!proof || !constantTimeEqual(proof, expected)) throw new Error("Pairing proof did not match.");
}

function normalizedPairingCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function pairingMessage(input: MeshPairProofInput): string {
  return JSON.stringify({
    scope: "aithy-mesh-pair-v2",
    pairingWindowId: input.pairingWindowId,
    fromPeerId: input.from.peerId,
    fromFingerprint: input.from.fingerprint,
    fromProtocolVersion: input.from.protocolVersion,
    toPeerId: input.to.peerId,
    toFingerprint: input.to.fingerprint,
    toProtocolVersion: input.to.protocolVersion,
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}
