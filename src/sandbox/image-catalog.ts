import { createHash } from "node:crypto";
import packageJson from "../../package.json" with { type: "json" };

export const INTERNAL_SANDBOX_IMAGE_IDS = ["aithy-sandbox", "aithy-sandbox-lite"] as const;
export type InternalSandboxImageId = typeof INTERNAL_SANDBOX_IMAGE_IDS[number];
export type SandboxImageRuntimeKind = "dev" | "packaged";
export type SandboxImageArch = "amd64" | "arm64";

export type SandboxImageSelection =
  | { kind: "internal"; id: InternalSandboxImageId }
  | { kind: "custom"; id: string };

export interface CustomSandboxImage {
  id: string;
  name: string;
  image: string;
}

export interface SandboxImageCatalogEntry {
  id: InternalSandboxImageId;
  name: string;
  description: string;
  repository: string;
}

export interface SandboxImageOption {
  kind: "internal" | "custom";
  id: string;
  name: string;
  description?: string;
  image: string;
}

export interface SandboxImageResolutionContext {
  runtimeKind: SandboxImageRuntimeKind;
  arch: SandboxImageArch;
  version: string;
}

export interface SandboxImageConfig {
  selection: SandboxImageSelection;
  customImages: CustomSandboxImage[];
  image: string;
  label: string;
  options: SandboxImageOption[];
}

export const DEFAULT_SANDBOX_IMAGE_SELECTION: SandboxImageSelection = {
  kind: "internal",
  id: "aithy-sandbox",
};

export const INTERNAL_SANDBOX_IMAGES: readonly SandboxImageCatalogEntry[] = [
  {
    id: "aithy-sandbox",
    name: "Aithy Sandbox",
    description: "Full document sandbox with Python, Docling, OCR, PDF/image tooling, fonts, and shell tools.",
    repository: "ghcr.io/dosco/aithy-sandbox",
  },
  {
    id: "aithy-sandbox-lite",
    name: "Aithy Sandbox Lite",
    description: "Core Python shell sandbox with bash, curl/wget, pip/venv, and small common Python libraries.",
    repository: "ghcr.io/dosco/aithy-sandbox-lite",
  },
];

const PACKAGE_VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
const LEGACY_PYTHON_SLIM = "python:3.11-slim";

export function defaultSandboxImageResolutionContext(
  runtimeKind: SandboxImageRuntimeKind = runtimeKindFromEnv(),
): SandboxImageResolutionContext {
  return {
    runtimeKind,
    arch: sandboxImageArch(process.arch),
    version: PACKAGE_VERSION,
  };
}

export function resolveSandboxImageConfig(
  settings: {
    sandboxImageSelection?: unknown;
    customSandboxImages?: unknown;
    sandboxImage?: string;
  },
  context = defaultSandboxImageResolutionContext(),
): SandboxImageConfig {
  const customImages = normalizeCustomSandboxImages(settings.customSandboxImages);
  const selection = normalizeSandboxImageSelection(settings.sandboxImageSelection, customImages)
    ?? legacySelection(settings.sandboxImage, customImages)
    ?? DEFAULT_SANDBOX_IMAGE_SELECTION;
  const selected = selection.kind === "custom"
    ? customImages.find((image) => image.id === selection.id)
    : undefined;
  const safeSelection = selection.kind === "custom" && !selected
    ? DEFAULT_SANDBOX_IMAGE_SELECTION
    : selection;
  const image = safeSelection.kind === "custom"
    ? selected!.image
    : resolveInternalSandboxImageRef(safeSelection.id as InternalSandboxImageId, context);
  const label = safeSelection.kind === "custom"
    ? selected!.name
    : internalImageFor(safeSelection.id as InternalSandboxImageId).name;
  return {
    selection: safeSelection,
    customImages,
    image,
    label,
    options: sandboxImageOptions(customImages, context),
  };
}

export function normalizeSandboxImageSettings(settings: {
  sandboxImageSelection?: unknown;
  customSandboxImages?: unknown;
  sandboxImage?: string;
}): Pick<SandboxImageConfig, "selection" | "customImages"> {
  const config = resolveSandboxImageConfig(settings);
  return { selection: config.selection, customImages: config.customImages };
}

export function resolveInternalSandboxImageRef(
  id: InternalSandboxImageId,
  context = defaultSandboxImageResolutionContext(),
): string {
  const image = internalImageFor(id);
  const tag = context.runtimeKind === "packaged"
    ? `v${context.version}-${context.arch}`
    : `latest-${context.arch}`;
  return `${image.repository}:${tag}`;
}

export function sandboxImageOptions(
  customImages: readonly CustomSandboxImage[],
  context = defaultSandboxImageResolutionContext(),
): SandboxImageOption[] {
  return [
    ...INTERNAL_SANDBOX_IMAGES.map((image) => ({
      kind: "internal" as const,
      id: image.id,
      name: image.name,
      description: image.description,
      image: resolveInternalSandboxImageRef(image.id, context),
    })),
    ...customImages.map((image) => ({
      kind: "custom" as const,
      id: image.id,
      name: image.name,
      image: image.image,
    })),
  ];
}

export function isInternalSandboxImageId(value: unknown): value is InternalSandboxImageId {
  return typeof value === "string" && INTERNAL_SANDBOX_IMAGE_IDS.includes(value as InternalSandboxImageId);
}

export function sandboxImageArch(arch: string): SandboxImageArch {
  return arch === "arm64" ? "arm64" : "amd64";
}

function runtimeKindFromEnv(): SandboxImageRuntimeKind {
  return process.env.AITHY_RUNTIME_KIND === "packaged" ? "packaged" : "dev";
}

function normalizeSandboxImageSelection(
  value: unknown,
  customImages: readonly CustomSandboxImage[],
): SandboxImageSelection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.kind === "internal" && isInternalSandboxImageId(record.id)) {
    return { kind: "internal", id: record.id };
  }
  if (record.kind === "custom" && typeof record.id === "string") {
    const id = cleanId(record.id);
    if (id && customImages.some((image) => image.id === id)) return { kind: "custom", id };
  }
  return undefined;
}

function normalizeCustomSandboxImages(value: unknown): CustomSandboxImage[] {
  if (!Array.isArray(value)) return [];
  const images: CustomSandboxImage[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const image = cleanString(record.image);
    if (!image) continue;
    const id = cleanId(record.id) ?? customImageId(image);
    if (seen.has(id)) continue;
    seen.add(id);
    images.push({
      id,
      name: cleanString(record.name) ?? image,
      image,
    });
  }
  return images.slice(0, 20);
}

function legacySelection(
  image: string | undefined,
  customImages: CustomSandboxImage[],
): SandboxImageSelection | undefined {
  const cleaned = cleanString(image);
  if (!cleaned) return undefined;
  if (isAithySandboxImageRef(cleaned) || cleaned === LEGACY_PYTHON_SLIM) {
    return DEFAULT_SANDBOX_IMAGE_SELECTION;
  }
  const id = customImageId(cleaned);
  if (!customImages.some((item) => item.id === id)) {
    customImages.push({ id, name: cleaned, image: cleaned });
  }
  return { kind: "custom", id };
}

function isAithySandboxImageRef(image: string): boolean {
  const value = image.trim().toLowerCase();
  return INTERNAL_SANDBOX_IMAGES.some((entry) => {
    const repo = entry.repository.toLowerCase();
    return value === repo || value.startsWith(`${repo}:`) || value.startsWith(`${repo}@`);
  });
}

function internalImageFor(id: InternalSandboxImageId): SandboxImageCatalogEntry {
  const image = INTERNAL_SANDBOX_IMAGES.find((entry) => entry.id === id);
  if (!image) throw new Error(`Unknown sandbox image: ${id}`);
  return image;
}

function customImageId(image: string): string {
  return `custom-${createHash("sha256").update(image).digest("hex").slice(0, 12)}`;
}

function cleanId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 80);
  return cleaned || undefined;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
