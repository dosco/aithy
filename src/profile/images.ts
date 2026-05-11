import type { StoredProfileImage } from "./types";

export const profileImageMimeType = "image/webp";
export const profileImageSize = 256;
export const maxProfileImageBytes = 8 * 1024 * 1024;

const acceptedInputTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/avif",
]);

interface BunImageOutput {
  webp: (options: Record<string, unknown>) => { bytes: () => Promise<Uint8Array> };
}

type BunImageConstructor = new (input: Uint8Array | ArrayBuffer | Blob) => {
  resize: (width: number, height: number, options: Record<string, unknown>) => BunImageOutput;
};

export function assertProfileImageInput(mimeType: string, byteLength: number): void {
  if (!acceptedInputTypes.has(mimeType)) {
    throw new Error("Profile photos must be JPEG, PNG, WebP, HEIC, or AVIF images.");
  }
  if (byteLength > maxProfileImageBytes) {
    throw new Error("Profile photos must be 8 MB or smaller.");
  }
}

export function hasNativeBunImage(): boolean {
  return typeof (Bun as unknown as { Image?: unknown }).Image === "function";
}

export async function resizeProfileImage(
  bytes: Uint8Array,
  mimeType: string,
): Promise<StoredProfileImage> {
  assertProfileImageInput(mimeType, bytes.byteLength);
  const ImageCtor = (Bun as unknown as { Image?: BunImageConstructor }).Image;
  if (!ImageCtor) {
    throw new Error("Profile photo processing requires Bun 1.3.13 or newer.");
  }
  const image = new ImageCtor(bytes);
  const resized = await image
    .resize(profileImageSize, profileImageSize, { fit: "fill", withoutEnlargement: true })
    .webp({ quality: 82 })
    .bytes();
  return {
    mimeType: profileImageMimeType,
    bytes: resized,
    width: profileImageSize,
    height: profileImageSize,
  };
}
