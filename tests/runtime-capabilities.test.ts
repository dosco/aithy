import { describe, expect, test } from "bun:test";
import { runtimeCapabilitiesDto } from "../app/server/dto";
import { hasNativeBunImage } from "../src/profile/images";

describe("runtime capabilities DTO", () => {
  test("reports Bun image support and version", () => {
    expect(runtimeCapabilitiesDto()).toEqual({
      profileImages: hasNativeBunImage(),
      bunVersion: Bun.version,
    });
  });
});
