import { connect, type PeerCertificate } from "node:tls";
import {
  certificatePemFromPeer,
  MESH_TLS_SERVER_NAME,
  peerCertificateFingerprint,
} from "./tls-cert";
import type { MeshTransport } from "./types";

type MeshFetchInit = RequestInit & {
  protocol?: string;
  tls?: {
    ca?: string[];
    cert?: string;
    key?: string;
    rejectUnauthorized?: boolean;
    serverName?: string;
    checkServerIdentity?: (hostname: string, cert: PeerCertificate) => Error | undefined;
  };
};

export interface MeshFetchResult<T> {
  value: T;
  transport: MeshTransport;
}

export interface ObservedMeshCertificate {
  certificatePem: string;
  fingerprint: string;
}

export async function probeMeshCertificate(host: string, port: number): Promise<ObservedMeshCertificate> {
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: tlsHost(host),
      port,
      servername: MESH_TLS_SERVER_NAME,
      // Initial pairing probe only; callers immediately pin and verify this exact leaf fingerprint.
      rejectUnauthorized: false,
      timeout: 4_000,
    });
    socket.once("secureConnect", () => {
      try {
        const cert = socket.getPeerCertificate();
        resolve({
          certificatePem: certificatePemFromPeer(cert),
          fingerprint: peerCertificateFingerprint(cert),
        });
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Mesh TLS certificate probe timed out."));
    });
    socket.once("error", reject);
  });
}

export async function fetchPinnedMeshJson<T>(input: {
  fetchImpl: typeof fetch;
  url: string;
  init?: RequestInit;
  certificatePem: string;
  fingerprint: string;
  preferHttp3: boolean;
}): Promise<MeshFetchResult<T>> {
  const transports: MeshTransport[] = input.preferHttp3 ? ["http3", "http2", "http1.1"] : ["http2", "http1.1"];
  let lastTransportError: unknown = null;
  for (const transport of transports) {
    try {
      return {
        value: await fetchJsonOnce<T>(input.fetchImpl, input.url, {
          ...input.init,
          ...(transport === "http1.1" ? {} : { protocol: transport }),
          tls: pinnedTls(input.certificatePem, input.fingerprint),
        }),
        transport,
      };
    } catch (error) {
      if (error instanceof MeshHttpStatusError) throw error;
      lastTransportError = error;
    }
  }
  throw lastTransportError instanceof Error ? lastTransportError : new Error("Mesh HTTPS request failed.");
}

export async function fetchUnverifiedMeshJson<T>(input: {
  fetchImpl: typeof fetch;
  url: string;
  init?: RequestInit;
  certificatePem: string;
  fingerprint: string;
}): Promise<T> {
  return fetchJsonOnce<T>(input.fetchImpl, input.url, {
    ...input.init,
    tls: pinnedTls(input.certificatePem, input.fingerprint),
  });
}

export function meshHttpsUrl(host: string, port: number, path: string): string {
  return `https://${formatUrlHost(host)}:${port}${path}`;
}

function pinnedTls(certificatePem: string, expectedFingerprint: string): MeshFetchInit["tls"] {
  return {
    ca: [certificatePem],
    serverName: MESH_TLS_SERVER_NAME,
    checkServerIdentity: (_hostname, cert) => {
      const actual = peerCertificateFingerprint(cert);
      return actual === expectedFingerprint
        ? undefined
        : new Error("Mesh TLS certificate fingerprint mismatch.");
    },
  };
}

async function fetchJsonOnce<T>(fetchImpl: typeof fetch, url: string, init: MeshFetchInit): Promise<T> {
  const response = await fetchImpl(url, init as RequestInit);
  const body = await response.json() as T | { error?: string };
  if (!response.ok) {
    throw new MeshHttpStatusError(
      typeof (body as { error?: string }).error === "string" ? (body as { error: string }).error : "Mesh request failed",
      response.status,
    );
  }
  return body as T;
}

class MeshHttpStatusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function tlsHost(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
