import { describe, expect, test } from "bun:test";
import {
  assertProfileImageInput,
  profileImageMimeType,
  profileImageSize,
  resizeProfileImage,
} from "../src/profile/images";

describe("profile image processing", () => {
  test("rejects unsupported input MIME types", () => {
    expect(() => assertProfileImageInput("image/gif", 10)).toThrow("JPEG, PNG, WebP, HEIC, or AVIF");
  });

  test("rejects oversized input images", () => {
    expect(() => assertProfileImageInput("image/png", 9 * 1024 * 1024)).toThrow("8 MB or smaller");
  });

  test("resizes accepted images to WebP avatars", async () => {
    const result = await resizeProfileImage(tinyPng(), "image/png");
    expect(result.mimeType).toBe(profileImageMimeType);
    expect(result.width).toBe(profileImageSize);
    expect(result.height).toBe(profileImageSize);
    expect(result.bytes.byteLength).toBeGreaterThan(0);
  });
});

function tinyPng(): Uint8Array {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  );
}
