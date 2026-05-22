import { SqliteMeshStore } from "./store";
import { parseMeshProviderId } from "./types";

export function meshProxyBaseUrl(port: number, peerId: string, serviceId: string): string {
  return `http://127.0.0.1:${port}/mesh/proxy/${encodeURIComponent(peerId)}/inference/${
    encodeURIComponent(serviceId)
  }/v1`;
}

export function meshSearchProxyUrl(port: number, peerId: string, serviceId: string): string {
  return `http://127.0.0.1:${port}/mesh/proxy/${encodeURIComponent(peerId)}/search/${encodeURIComponent(serviceId)}`;
}

export function meshProxyUrlFromState(stateDbPath: string, providerId: string): string | undefined {
  const parsed = parseMeshProviderId(providerId);
  if (!parsed) return undefined;
  const store = new SqliteMeshStore(stateDbPath);
  try {
    if (!store.meshEnabled()) return undefined;
    const port = store.proxyPort();
    if (!port) return undefined;
    return parsed.kind === "inference"
      ? meshProxyBaseUrl(port, parsed.peerId, parsed.serviceId)
      : meshSearchProxyUrl(port, parsed.peerId, parsed.serviceId);
  } finally {
    store.close();
  }
}
