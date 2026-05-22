import { createHash } from "node:crypto";
import type { PeerCertificate } from "node:tls";

const encoder = new TextEncoder();
export const MESH_TLS_SERVER_NAME = "aithy.mesh";

export interface MeshCertificateMaterial {
  privateKeyPem: string;
  certificatePem: string;
  fingerprint: string;
}

export async function createMeshCertificate(input: {
  peerId: string;
  displayName: string;
  now?: Date;
}): Promise<MeshCertificateMaterial> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateKeyDer = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const publicKeyDer = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));
  const now = input.now ?? new Date();
  const tbs = tbsCertificate({
    peerId: input.peerId,
    displayName: input.displayName,
    publicKeyDer,
    notBefore: new Date(now.getTime() - 24 * 60 * 60_000),
    notAfter: new Date(now.getTime() + 10 * 365 * 24 * 60 * 60_000),
  });
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    bufferSource(tbs),
  );
  const certificateDer = seq(tbs, ecdsaWithSha256(), bitString(ecdsaSignatureDer(new Uint8Array(signature))));
  const certificatePem = pemBlock("CERTIFICATE", certificateDer);
  return {
    privateKeyPem: pemBlock("PRIVATE KEY", privateKeyDer),
    certificatePem,
    fingerprint: await certificateFingerprint(certificatePem),
  };
}

export async function certificateFingerprint(certificatePem: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bufferSource(pemToDer(certificatePem)));
  return base64Url(new Uint8Array(digest));
}

export function peerCertificateFingerprint(cert: PeerCertificate): string {
  if (cert.fingerprint256) return base64Url(Buffer.from(cert.fingerprint256.replace(/:/g, ""), "hex"));
  if (cert.raw) return base64Url(createHash("sha256").update(cert.raw).digest());
  throw new Error("Mesh peer did not provide a TLS certificate fingerprint.");
}

export function certificatePemFromPeer(cert: PeerCertificate): string {
  if (!cert.raw) throw new Error("Mesh peer did not provide a TLS certificate.");
  return pemBlock("CERTIFICATE", new Uint8Array(cert.raw));
}

export function normalizeCertificateFingerprint(value: string): string {
  return value.includes(":")
    ? base64Url(Buffer.from(value.replace(/:/g, ""), "hex"))
    : value.trim();
}

export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return new Uint8Array(Buffer.from(body, "base64"));
}

function tbsCertificate(input: {
  peerId: string;
  displayName: string;
  publicKeyDer: Uint8Array;
  notBefore: Date;
  notAfter: Date;
}): Uint8Array {
  const subject = name(input.displayName, input.peerId);
  return seq(
    explicit(0, integer(new Uint8Array([2]))),
    integer(serialBytes()),
    ecdsaWithSha256(),
    subject,
    seq(utcTime(input.notBefore), utcTime(input.notAfter)),
    subject,
    input.publicKeyDer,
    explicit(3, seq(
      extension("2.5.29.19", true, seq(bool(true))),
      extension("2.5.29.15", true, bitString(new Uint8Array([0x84]), 2)),
      extension("2.5.29.37", false, seq(oid("1.3.6.1.5.5.7.3.1"))),
      extension("2.5.29.17", false, seq(tagged(0x82, encoder.encode(MESH_TLS_SERVER_NAME)))),
    )),
  );
}

function name(displayName: string, peerId: string): Uint8Array {
  const commonName = `${displayName || "Aithy"} ${peerId.slice(0, 8)}`.slice(0, 64);
  return seq(set(seq(oid("2.5.4.3"), utf8(commonName))));
}

function extension(id: string, critical: boolean, value: Uint8Array): Uint8Array {
  return critical ? seq(oid(id), bool(true), octetString(value)) : seq(oid(id), octetString(value));
}

function ecdsaWithSha256(): Uint8Array {
  return seq(oid("1.2.840.10045.4.3.2"));
}

function ecdsaSignatureDer(raw: Uint8Array): Uint8Array {
  if (raw.length !== 64) throw new Error("Unexpected ECDSA P-256 signature length.");
  return seq(integer(raw.slice(0, 32)), integer(raw.slice(32)));
}

function serialBytes(): Uint8Array {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] &= 0x7f;
  if (bytes.every((byte) => byte === 0)) bytes[15] = 1;
  return bytes;
}

function seq(...items: Uint8Array[]): Uint8Array {
  return tagged(0x30, concat(...items));
}

function set(...items: Uint8Array[]): Uint8Array {
  return tagged(0x31, concat(...items));
}

function explicit(index: number, value: Uint8Array): Uint8Array {
  return tagged(0xa0 + index, value);
}

function integer(bytes: Uint8Array): Uint8Array {
  const normalized = trimInteger(bytes);
  const positive = normalized[0] && (normalized[0] & 0x80) ? concat(new Uint8Array([0]), normalized) : normalized;
  return tagged(0x02, positive);
}

function bool(value: boolean): Uint8Array {
  return tagged(0x01, new Uint8Array([value ? 0xff : 0]));
}

function oid(value: string): Uint8Array {
  const parts = value.split(".").map((part) => Number(part));
  const bytes = [40 * parts[0] + parts[1]];
  for (const part of parts.slice(2)) bytes.push(...base128(part));
  return tagged(0x06, new Uint8Array(bytes));
}

function utf8(value: string): Uint8Array {
  return tagged(0x0c, encoder.encode(value));
}

function utcTime(value: Date): Uint8Array {
  const year = value.getUTCFullYear() % 100;
  const stamp = `${pad(year)}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}`
    + `${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`;
  return tagged(0x17, encoder.encode(stamp));
}

function octetString(value: Uint8Array): Uint8Array {
  return tagged(0x04, value);
}

function bitString(value: Uint8Array, unusedBits = 0): Uint8Array {
  return tagged(0x03, concat(new Uint8Array([unusedBits]), value));
}

function tagged(tag: number, value: Uint8Array): Uint8Array {
  return concat(new Uint8Array([tag]), lengthBytes(value.length), value);
}

function lengthBytes(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function base128(value: number): number[] {
  const out = [value & 0x7f];
  let next = value >> 7;
  while (next > 0) {
    out.unshift(0x80 | (next & 0x7f));
    next >>= 7;
  }
  return out;
}

function trimInteger(bytes: Uint8Array): Uint8Array {
  let index = 0;
  while (index < bytes.length - 1 && bytes[index] === 0 && (bytes[index + 1] & 0x80) === 0) index += 1;
  return bytes.slice(index);
}

function pemBlock(label: string, bytes: Uint8Array): string {
  const body = Buffer.from(bytes).toString("base64").replace(/(.{64})/g, "$1\n").trim();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function concat(...items: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(items.reduce((total, item) => total + item.length, 0));
  let offset = 0;
  for (const item of items) {
    out.set(item, offset);
    offset += item.length;
  }
  return out;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
