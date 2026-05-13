import { describe, expect, test } from "bun:test";
import { combineResponderDescription, userProfileForAgent } from "../src/profile/service";

describe("profile service", () => {
  test("keeps user profile out of responder descriptions", () => {
    const prompt = combineResponderDescription("Soul guidance.");

    expect(prompt).toBe("Soul guidance.");
  });

  test("renders user profile as agent input data", () => {
    const input = userProfileForAgent({
      userName: "Violet",
      userLocation: "Vancouver",
      updatedAt: "now",
    });

    expect(input).toEqual({ name: "Violet", location: "Vancouver" });
  });

  test("omits empty optional location from agent input data", () => {
    const input = userProfileForAgent({
      userName: "Violet",
      userLocation: "",
      updatedAt: "now",
    });

    expect(input).toEqual({ name: "Violet" });
  });
});
