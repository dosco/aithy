import { describe, expect, test } from "bun:test";
import { combineResponderDescription } from "../src/profile/service";

describe("profile responder context", () => {
  test("includes user name and omits empty optional location", () => {
    const prompt = combineResponderDescription("Soul guidance.", {
      userName: "Violet",
      userLocation: "",
      updatedAt: "now",
    });
    expect(prompt).toContain("Soul guidance.");
    expect(prompt).toContain("Name: Violet");
    expect(prompt).not.toContain("Location:");
  });
});
