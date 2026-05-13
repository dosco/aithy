import { describe, expect, test } from "bun:test";
import { runtimeCapabilitiesDto } from "../app/server/dto";

describe("runtime capabilities DTO", () => {
  test("reports the Bun version", () => {
    expect(runtimeCapabilitiesDto()).toEqual({
      bunVersion: Bun.version,
    });
  });
});
