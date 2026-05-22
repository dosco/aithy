import { describe, expect, test } from "bun:test";
import { bearerToken, isLoopbackAddress, validateMeshHello } from "../src/mesh/http";
import { assertMeshProxyRequest, assertMeshRequestSize, readMeshJson } from "../src/mesh/server-guards";

describe("mesh HTTP guards", () => {
  test("recognizes only loopback callers for local mesh proxy routes", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.4.5.6")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.20")).toBe(false);
    expect(isLoopbackAddress("10.0.0.2")).toBe(false);
  });

  test("extracts bearer tokens for the local proxy CSRF gate", () => {
    expect(bearerToken(new Request("http://127.0.0.1", { headers: { authorization: "Bearer aithy-mesh" } })))
      .toBe("aithy-mesh");
    expect(bearerToken(new Request("http://127.0.0.1", { headers: { authorization: "Basic x" } }))).toBeNull();
  });

  test("requires loopback and bearer auth for local proxy routes", () => {
    const authed = new Request("http://127.0.0.1", { headers: { authorization: "Bearer aithy-mesh" } });
    expect(() => assertMeshProxyRequest(authed, "127.0.0.1")).not.toThrow();
    expect(() => assertMeshProxyRequest(authed, "192.168.1.20")).toThrow(/loopback/);
    expect(() => assertMeshProxyRequest(new Request("http://127.0.0.1"), "127.0.0.1")).toThrow(/authorization/);
  });

  test("rejects oversized mesh HTTP bodies before parsing JSON", () => {
    expect(() => assertMeshRequestSize(new Request("http://127.0.0.1", {
      headers: { "content-length": String(9 * 1024 * 1024) },
    }))).toThrow(/too large/);
  });

  test("reads normal mesh JSON bodies through the capped parser", async () => {
    await expect(readMeshJson(new Request("http://127.0.0.1", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    }))).resolves.toEqual({ ok: true });
  });

  test("rejects unsupported mesh hello protocol versions", () => {
    expect(() => validateMeshHello({
      peerId: "peer",
      displayName: "Aithy",
      fingerprint: "fp",
      protocolVersion: "0",
      certificatePem: "cert",
    })).toThrow(/Unsupported/);
  });
});
