import { describe, expect, test } from "bun:test";
import { fetchPinnedMeshJson } from "../src/mesh/transport";

describe("mesh pinned transport", () => {
  test("prefers HTTP/3 and falls back without disabling TLS verification", async () => {
    const protocols: unknown[] = [];
    const rejectUnauthorized: unknown[] = [];
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const meshInit = init as RequestInit & { protocol?: string; tls?: { rejectUnauthorized?: boolean } };
      protocols.push(meshInit.protocol ?? "default");
      rejectUnauthorized.push(meshInit.tls?.rejectUnauthorized);
      if (meshInit.protocol === "http3") throw new Error("h3 unavailable");
      return Response.json({ ok: true });
    }) as typeof fetch;

    const result = await fetchPinnedMeshJson<{ ok: boolean }>({
      fetchImpl: fakeFetch,
      url: "https://192.168.1.20:49321/mesh/rpc",
      certificatePem: "cert",
      fingerprint: "fp",
      preferHttp3: true,
    });

    expect(result).toEqual({ value: { ok: true }, transport: "http2" });
    expect(protocols).toEqual(["http3", "http2"]);
    expect(rejectUnauthorized).toEqual([undefined, undefined]);
  });
});
