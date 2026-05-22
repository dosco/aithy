import { createServer } from "node:net";
import type { MeshIdentityMaterial } from "./identity";

export interface MeshServers {
  server: ReturnType<typeof Bun.serve>;
  proxyServer: ReturnType<typeof Bun.serve>;
  http3Enabled: boolean;
  serverError: string | null;
}

type MeshFetchHandler = (req: Request, server: ReturnType<typeof Bun.serve>) => Promise<Response>;

export function startMeshServers(input: {
  port: number;
  fetchHandler: MeshFetchHandler;
  identity: MeshIdentityMaterial;
}): MeshServers {
  const lan = serveLan(input.fetchHandler, input.port, input.identity);
  const proxyServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: input.fetchHandler });
  return { ...lan, proxyServer };
}

export async function chooseMeshPort(preferred: number | null): Promise<number> {
  if (preferred && preferred > 0) return preferred;
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) resolve(address.port);
        else reject(new Error("Could not choose a mesh port."));
      });
    });
  });
}

function serveLan(
  fetchHandler: MeshFetchHandler,
  port: number,
  identity: MeshIdentityMaterial,
): Omit<MeshServers, "proxyServer"> {
  try {
    return {
      server: Bun.serve({
        hostname: "0.0.0.0",
        port,
        fetch: fetchHandler,
        tls: { key: identity.privateKeyPem, cert: identity.certificatePem },
        http3: true,
      }),
      http3Enabled: true,
      serverError: null,
    };
  } catch (error) {
    return {
      server: Bun.serve({
        hostname: "0.0.0.0",
        port,
        fetch: fetchHandler,
        tls: { key: identity.privateKeyPem, cert: identity.certificatePem },
      }),
      http3Enabled: false,
      serverError: error instanceof Error ? error.message : String(error),
    };
  }
}
