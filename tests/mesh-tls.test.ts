import { createPrivateKey, X509Certificate } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { certificateFingerprint, createMeshCertificate } from "../src/mesh/tls-cert";

describe("mesh TLS identity", () => {
  test("generates a self-signed P-256 certificate and stable public fingerprint", async () => {
    const material = await createMeshCertificate({
      peerId: "peer-1",
      displayName: "Studio Aithy",
      now: new Date("2026-05-21T00:00:00Z"),
    });
    const cert = new X509Certificate(material.certificatePem);
    expect(cert.verify(cert.publicKey)).toBe(true);
    expect(cert.checkPrivateKey(createPrivateKey(material.privateKeyPem))).toBe(true);
    expect(await certificateFingerprint(material.certificatePem)).toBe(material.fingerprint);
    expect(material.fingerprint).not.toContain("PRIVATE KEY");
  });
});
