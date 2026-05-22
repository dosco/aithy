import { randomUUID } from "node:crypto";
import { aithySecretService, BunSecretStore, type SecretStore } from "../settings/secrets";
import { createMeshCertificate } from "./tls-cert";
import {
  AITHY_MESH_PROTOCOL_VERSION,
  type MeshIdentity,
} from "./types";

export interface MeshIdentityStore {
  loadSetting<T>(key: string): T | null;
  saveSetting<T>(key: string, value: T): void;
  deleteSetting(key: string): void;
}

interface StoredIdentity {
  peerId: string;
  displayName: string;
  fingerprint: string;
  certificatePem: string;
  supportsHttp3: boolean;
  protocolVersion: string;
}

export interface MeshIdentityMaterial extends MeshIdentity {
  privateKeyPem: string;
}

const identitySettingKey = "identity";
const legacyMeshPrivateKeySecretName = "mesh.identity.tls-private-key";

export function meshPrivateKeySecretName(): string {
  return "aithy.mesh.identity.tls-private-key";
}

export async function loadOrCreateMeshIdentity(
  botId: string,
  store: MeshIdentityStore,
  displayName: string,
  secrets: SecretStore = BunSecretStore,
): Promise<MeshIdentityMaterial> {
  const stored = normalizeStoredIdentity(store.loadSetting<StoredIdentity>(identitySettingKey));
  const privateKey = await readPrivateKeyPem(botId, secrets);
  if (stored && privateKey) {
    if (stored.displayName !== displayName) {
      store.saveSetting(identitySettingKey, { ...stored, displayName });
    }
    return { ...stored, displayName, privateKeyPem: privateKey };
  }
  return createMeshIdentity(botId, store, displayName, secrets);
}

export async function regenerateMeshIdentity(
  botId: string,
  store: MeshIdentityStore,
  displayName: string,
  secrets: SecretStore = BunSecretStore,
): Promise<MeshIdentityMaterial> {
  store.deleteSetting(identitySettingKey);
  await secrets.delete({ service: aithySecretService(botId), name: meshPrivateKeySecretName() });
  await secrets.delete({ service: aithySecretService(botId), name: legacyMeshPrivateKeySecretName });
  return createMeshIdentity(botId, store, displayName, secrets);
}

export function updateMeshIdentityDisplayName(
  store: MeshIdentityStore,
  identity: MeshIdentityMaterial,
  displayName: string,
): MeshIdentityMaterial {
  const next = { ...identity, displayName };
  store.saveSetting<StoredIdentity>(identitySettingKey, {
    peerId: next.peerId,
    displayName: next.displayName,
    certificatePem: next.certificatePem,
    fingerprint: next.fingerprint,
    supportsHttp3: next.supportsHttp3,
    protocolVersion: next.protocolVersion,
  });
  return next;
}

async function createMeshIdentity(
  botId: string,
  store: MeshIdentityStore,
  displayName: string,
  secrets: SecretStore,
): Promise<MeshIdentityMaterial> {
  const peerId = randomUUID();
  const material = await createMeshCertificate({ peerId, displayName });
  const identity: StoredIdentity = {
    peerId,
    displayName,
    certificatePem: material.certificatePem,
    fingerprint: material.fingerprint,
    supportsHttp3: true,
    protocolVersion: AITHY_MESH_PROTOCOL_VERSION,
  };
  await secrets.set({
    service: aithySecretService(botId),
    name: meshPrivateKeySecretName(),
    value: material.privateKeyPem,
  });
  store.saveSetting(identitySettingKey, identity);
  return { ...identity, privateKeyPem: material.privateKeyPem };
}

async function readPrivateKeyPem(botId: string, secrets: SecretStore): Promise<string | null> {
  let raw: string | null;
  try {
    raw = await secrets.get({
      service: aithySecretService(botId),
      name: meshPrivateKeySecretName(),
    }) ?? await secrets.get({
      service: aithySecretService(botId),
      name: legacyMeshPrivateKeySecretName,
    });
  } catch {
    return null;
  }
  if (!raw) return null;
  return raw.includes("-----BEGIN PRIVATE KEY-----") ? raw : null;
}

function normalizeStoredIdentity(value: StoredIdentity | null): StoredIdentity | null {
  if (!value || typeof value !== "object") return null;
  if (!value.peerId || !value.certificatePem || !value.fingerprint) return null;
  return {
    peerId: value.peerId,
    displayName: value.displayName || "Aithy",
    certificatePem: value.certificatePem,
    fingerprint: value.fingerprint,
    supportsHttp3: value.supportsHttp3 !== false,
    protocolVersion: value.protocolVersion || AITHY_MESH_PROTOCOL_VERSION,
  };
}
