import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { PullProgressEventLike } from "../setup/status";

export interface MicrosandboxExecOutput {
  code?: number;
  stdout(): string;
  stderr(): string;
}

export interface MicrosandboxFs {
  readToString(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export interface MicrosandboxInstance {
  exec(cmd: string, args: string[]): Promise<MicrosandboxExecOutput>;
  fs(): MicrosandboxFs;
  stopAndWait?(): Promise<void>;
  stop?(): Promise<void>;
  removePersisted?(): Promise<void>;
}

export interface MicrosandboxBuilder {
  image(value: string): MicrosandboxBuilder;
  cpus(value: number): MicrosandboxBuilder;
  memory(value: number): MicrosandboxBuilder;
  replace(): MicrosandboxBuilder;
  registry?(configure: (registry: { auth(auth: { kind: string }): unknown }) => unknown): MicrosandboxBuilder;
  network(configure: (network: { policy(policy: unknown): unknown }) => unknown): MicrosandboxBuilder;
  volume(path: string, configure: (volume: { bind(path: string): { readonly?(): unknown } }) => unknown): MicrosandboxBuilder;
  libkrunfwPath?(path: string): MicrosandboxBuilder;
  create(): Promise<MicrosandboxInstance>;
  createWithPullProgress?(): Promise<{
    progress: AsyncIterable<PullProgressEventLike>;
    awaitSandbox(): Promise<MicrosandboxInstance>;
  }>;
}

export interface MicrosandboxFactory {
  builder(name: string): MicrosandboxBuilder;
  get?(name: string): Promise<{ startDetached(): Promise<MicrosandboxInstance> }>;
  remove?(name: string): Promise<void>;
}

export function applyBundledRuntime(builder: MicrosandboxBuilder): MicrosandboxBuilder {
  if (typeof builder.libkrunfwPath !== "function") return builder;
  const libkrunfwPath = resolveBundledLibkrunfwPath();
  return libkrunfwPath ? builder.libkrunfwPath(libkrunfwPath) : builder;
}

export async function stopSandbox(sandbox: MicrosandboxInstance): Promise<void> {
  if (typeof sandbox.stopAndWait === "function") await sandbox.stopAndWait();
  else if (typeof sandbox.stop === "function") await sandbox.stop();
  if (typeof sandbox.removePersisted === "function") await sandbox.removePersisted();
}

export function formatMicrosandboxStartError(error: unknown): string {
  const message = formatError(error);
  if (/ghcr\.io\/v2\/dosco\/aithy-sandbox/i.test(message) && /not authorized|authentication required|denied/i.test(message)) {
    return `${message}. GHCR rejected the anonymous public pull for the Aithy sandbox image. Verify the GitHub package is public and retry sandbox setup.`;
  }
  if (/manifest unknown|name unknown|not found|404/i.test(message)) {
    return `${message}. The configured sandbox image or tag was not found. Choose an Aithy image or update the custom image reference in Settings -> Sandbox.`;
  }
  if (/manifest|image index|deserialize|serialize|mediaType/i.test(message) && /parse|invalid|expected|unknown/i.test(message)) {
    return `${message}. Microsandbox could not parse the image manifest. Aithy built-in images use arch-specific tags to avoid multi-arch manifest parsing issues; custom images may need an explicit architecture tag.`;
  }
  if (message.includes("libkrunfw not found")) {
    return `${message}. The bundled Microsandbox platform package was installed, but the runtime did not find libkrunfw. Try \`bun node_modules/.bin/microsandbox self install\` once, or set MSB_PATH/libkrunfwPath to a working Microsandbox runtime.`;
  }
  if (message.includes("Operation not permitted")) {
    return `${message}. Microsandbox could not start a microVM with the current host permissions. On macOS this usually means the terminal/app needs virtualization permission or the process is running inside a restricted sandbox; on Linux check KVM access.`;
  }
  return message;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveBundledLibkrunfwPath(): string | undefined {
  const triple = platformTriple();
  if (!triple) return undefined;
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve(`@superradcompany/microsandbox-${triple}/package.json`);
    const root = path.dirname(packagePath);
    const name = process.platform === "darwin" ? "libkrunfw.5.dylib" : "libkrunfw.so";
    const candidate = path.join(root, "lib", name);
    return existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function platformTriple(): string | undefined {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64-gnu";
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64-gnu";
  return undefined;
}
