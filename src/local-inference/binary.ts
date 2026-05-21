import { access, chmod, mkdir, readdir } from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";

const GITHUB_RELEASE_BY_TAG = "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/";
const REQUIRED_HELP_FLAGS = ["--models-preset", "--models-max"];
const VERIFY_TIMEOUT_MS = 30_000;
const VERIFY_RETRIES = 1;

export interface LlamaServerBinary {
  path: string;
  source: "settings" | "managed";
  version: string;
}

export interface ResolveLlamaServerBinaryInput {
  stateRoot: string;
  settingsPath?: string;
  packageRoot?: string;
  fetchImpl?: typeof fetch;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleaseResponse {
  tag_name?: string;
  assets?: ReleaseAsset[];
}

interface PackageMetadata {
  aithy?: {
    llamaCppRelease?: unknown;
  };
}

export async function resolveLlamaServerBinary(
  input: ResolveLlamaServerBinaryInput,
): Promise<LlamaServerBinary> {
  const explicit = candidate("settings", clean(input.settingsPath));
  if (explicit) {
    return verifyLlamaServerBinary(explicit.path, explicit.source);
  }

  try {
    const managed = await ensureManagedLlamaServer({
      cacheDir: path.join(input.stateRoot, "local-inference", "llama.cpp"),
      packageRoot: input.packageRoot,
      fetchImpl: input.fetchImpl ?? fetch,
    });
    return verifyLlamaServerBinary(managed, "managed");
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`llama-server was not found from managed install or saved settings.${detail}`);
  }
}

export async function verifyLlamaServerBinary(
  binaryPath: string,
  source: LlamaServerBinary["source"] = "settings",
): Promise<LlamaServerBinary> {
  await access(binaryPath);
  const version = await runBinary(binaryPath, ["--version"]);
  const help = await runBinary(binaryPath, ["--help"]);
  const missing = REQUIRED_HELP_FLAGS.filter((flag) => !help.includes(flag));
  if (missing.length > 0) {
    throw new Error(`llama-server is too old or incompatible; missing ${missing.join(", ")}`);
  }
  return { path: binaryPath, source, version: firstLine(version) };
}

function candidate(
  source: LlamaServerBinary["source"],
  pathValue: string | undefined,
): { source: LlamaServerBinary["source"]; path: string } | null {
  return pathValue ? { source, path: expandHome(pathValue) } : null;
}

async function ensureManagedLlamaServer(input: {
  cacheDir: string;
  packageRoot?: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  await mkdir(input.cacheDir, { recursive: true });
  const tag = await loadPinnedLlamaCppRelease(input.packageRoot);
  const installDir = path.join(input.cacheDir, tag);
  const existing = await findLlamaServer(installDir);
  if (existing) return existing;

  const release = await fetchRelease(tag, input.fetchImpl);
  const asset = selectReleaseAsset(release.assets ?? []);
  if (!asset) throw new Error("no compatible llama.cpp release asset found");
  const archive = path.join(input.cacheDir, asset.name);
  await download(asset.browser_download_url, archive, input.fetchImpl);
  await mkdir(installDir, { recursive: true });
  await extractArchive(archive, installDir);
  const binary = await findLlamaServer(installDir);
  if (!binary) throw new Error("downloaded llama.cpp release did not contain llama-server");
  await chmod(binary, 0o755);
  return binary;
}

async function loadPinnedLlamaCppRelease(packageRoot = process.cwd()): Promise<string> {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const metadata = await Bun.file(packageJsonPath).json() as PackageMetadata;
  const tag = metadata.aithy?.llamaCppRelease;
  if (typeof tag !== "string" || !tag.trim()) {
    throw new Error("package.json is missing aithy.llamaCppRelease");
  }
  return tag.trim();
}

async function fetchRelease(tag: string, fetchImpl: typeof fetch): Promise<ReleaseResponse> {
  const response = await fetchImpl(`${GITHUB_RELEASE_BY_TAG}${encodeURIComponent(tag)}`, {
    headers: { "accept": "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub llama.cpp release ${tag} lookup failed: HTTP ${response.status}`);
  return response.json() as Promise<ReleaseResponse>;
}

function selectReleaseAsset(assets: readonly ReleaseAsset[]): ReleaseAsset | null {
  const os = platform();
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const osTerms = os === "darwin" ? ["macos", "darwin"] : os === "linux" ? ["linux"] : ["win"];
  return assets.find((asset) => {
    const name = asset.name.toLowerCase();
    return name.includes("bin")
      && osTerms.some((term) => name.includes(term))
      && name.includes(arch)
      && (name.endsWith(".zip") || name.endsWith(".tar.gz") || name.endsWith(".tgz"));
  }) ?? null;
}

async function download(url: string, destination: string, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`llama.cpp download failed: HTTP ${response.status}`);
  await Bun.write(destination, response);
}

async function extractArchive(archive: string, destination: string): Promise<void> {
  const lower = archive.toLowerCase();
  const command = lower.endsWith(".zip")
    ? ["/usr/bin/unzip", "-o", archive, "-d", destination]
    : ["/usr/bin/tar", "-xzf", archive, "-C", destination];
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`failed to extract llama.cpp release: ${stderr || `exit ${code}`}`);
  }
}

async function findLlamaServer(root: string): Promise<string | null> {
  for (const file of await walk(root)) {
    if (path.basename(file) === executableName("llama-server")) return file;
  }
  return null;
}

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function executableName(name: string): string {
  return platform() === "win32" ? `${name}.exe` : name;
}

async function runBinary(binaryPath: string, args: string[]): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= VERIFY_RETRIES; attempt += 1) {
    try {
      return await runBinaryOnce(binaryPath, args);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (!shouldRetryProbe(lastError) || attempt === VERIFY_RETRIES) break;
      await delay(500);
    }
  }
  throw lastError ?? new Error(`${binaryPath} ${args.join(" ")} failed`);
}

async function runBinaryOnce(binaryPath: string, args: string[]): Promise<string> {
  const proc = Bun.spawn([binaryPath, ...args], { stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, VERIFY_TIMEOUT_MS);
  if (typeof timeout === "object" && "unref" in timeout) timeout.unref();
  try {
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const output = `${stdout}\n${stderr}`.trim();
    if (code !== 0) throw new Error(`${binaryPath} ${args.join(" ")} failed: ${output || exitSummary(code, timedOut)}`);
    return output;
  } finally {
    clearTimeout(timeout);
  }
}

function shouldRetryProbe(error: Error): boolean {
  return /\bexit 137\b|\bsignal 9\b/.test(error.message);
}

function exitSummary(code: number, timedOut: boolean): string {
  if (timedOut) return `timed out after ${VERIFY_TIMEOUT_MS}ms (exit ${code})`;
  if (code >= 128) return `signal ${code - 128} (exit ${code})`;
  return `exit ${code}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
  return value;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0]?.trim() ?? "";
}
