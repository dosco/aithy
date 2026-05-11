import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { resizeProfileImage, maxProfileImageBytes } from "../../src/profile/images";
import type { ProfileImageKind } from "../../src/profile/types";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { profileDto } from "./dto";

const profileInput = z.object({
  userName: z.string().min(1).max(120),
  userLocation: z.string().max(240).optional(),
});

const imageKind = z.enum(["user", "agent"]);

const imageInput = z.object({
  kind: imageKind,
  mimeType: z.string().min(1).max(80),
  base64: z.string().min(1).max(Math.ceil(maxProfileImageBytes * 1.5)),
});

export const saveProfile = createServerFn({ method: "POST" })
  .inputValidator(profileInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const profile = runtime.updateProfile({
      userName: data.userName.trim(),
      userLocation: data.userLocation?.trim() ?? "",
    });
    return profileDto(profile);
  });

export const saveProfileImage = createServerFn({ method: "POST" })
  .inputValidator(imageInput)
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    const image = await resizeProfileImage(base64Bytes(data.base64), data.mimeType);
    return profileDto(runtime.updateProfileImage(data.kind, image));
  });

export const clearProfileImage = createServerFn({ method: "POST" })
  .inputValidator(z.object({ kind: imageKind }))
  .handler(async ({ data }) => {
    assertLoopbackRequest(getRequest());
    const runtime = await getAithyRuntime();
    return profileDto(runtime.clearProfileImage(data.kind as ProfileImageKind));
  });

function base64Bytes(value: string): Uint8Array {
  const clean = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const buffer = Buffer.from(clean, "base64");
  if (!buffer.byteLength || buffer.toString("base64").replace(/=+$/, "") !== clean.replace(/=+$/, "")) {
    throw new Error("Invalid image payload.");
  }
  return new Uint8Array(buffer);
}
