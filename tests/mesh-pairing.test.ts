import { describe, expect, test } from "bun:test";
import { assertPairingProof, generatePairingCode, pairingProof } from "../src/mesh/pairing";

describe("mesh pairing proof", () => {
  test("uses a human-entered code without sending the code itself", async () => {
    const code = generatePairingCode();
    const alice = { peerId: "alice", fingerprint: "alice-fp", protocolVersion: "2" };
    const bob = { peerId: "bob", fingerprint: "bob-fp", protocolVersion: "2" };
    const proof = await pairingProof({ code, from: alice, to: bob, pairingWindowId: "window-1" });

    expect(code).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
    expect(proof).not.toBe(code);
    await expect(assertPairingProof({
      code,
      proof,
      from: alice,
      to: bob,
      pairingWindowId: "window-1",
    })).resolves.toBeUndefined();
    await expect(assertPairingProof({
      code,
      proof,
      from: bob,
      to: alice,
      pairingWindowId: "window-1",
    })).rejects.toThrow(/proof/);
    await expect(assertPairingProof({
      code,
      proof,
      from: alice,
      to: bob,
      pairingWindowId: "window-2",
    })).rejects.toThrow(/proof/);
  });
});
