import { describe, expect, test } from "bun:test";
import { discoveredMeshPeerFromService, meshTxtRecord } from "../src/mesh/metadata";
import { AITHY_MESH_PROTOCOL_VERSION, AITHY_MESH_SERVICE_TYPE } from "../src/mesh/types";

describe("mesh discovery", () => {
  test("advertises only safe public identity metadata", () => {
    expect(meshTxtRecord({
      peerId: "peer-1",
      displayName: "Studio Aithy",
      port: 49321,
      fingerprint: "fp-test",
      supportsHttp3: true,
      protocolVersion: AITHY_MESH_PROTOCOL_VERSION,
    })).toEqual({
      peerId: "peer-1",
      name: "Studio Aithy",
      fp: "fp-test",
      proto: AITHY_MESH_PROTOCOL_VERSION,
      h3: "1",
    });
  });

  test("normalizes an mDNS service into a discovered mesh peer", () => {
    const peer = discoveredMeshPeerFromService({
      name: "Studio Aithy",
      type: AITHY_MESH_SERVICE_TYPE,
      port: 49321,
      host: "studio.local",
      addresses: ["127.0.0.1", "192.168.1.20"],
      txt: {
        peerId: "peer-1",
        name: "Studio Aithy",
        fp: "fp-test",
        proto: AITHY_MESH_PROTOCOL_VERSION,
        h3: "1",
        baseUrl: "http://192.168.1.20:49321/v1",
        apiKey: "sk-never",
        models: "secret-model",
      },
    } as any);

    expect(peer).toMatchObject({
      peerId: "peer-1",
      displayName: "Studio Aithy",
      host: "192.168.1.20",
      port: 49321,
      fingerprint: "fp-test",
      supportsHttp3: true,
      protocolVersion: AITHY_MESH_PROTOCOL_VERSION,
      verified: false,
    });
    expect(JSON.stringify(peer)).not.toContain("sk-never");
    expect(JSON.stringify(peer)).not.toContain("secret-model");
    expect(JSON.stringify(peer)).not.toContain("baseUrl");
  });
});
