import { chmod, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import packageJson from "../package.json" with { type: "json" };

export type ReleaseTarget = "darwin-arm64" | "linux-x64-gnu" | "linux-arm64-gnu";

interface TargetInfo {
  bunAsset: string;
  sqlitePackage: string;
  microsandboxPackage: string;
}

interface PackagePlan {
  target: ReleaseTarget;
  appEntrypoint: string;
  workerEntrypoints: string[];
  nativePackages: string[];
  excludedServices: string[];
}

const TARGETS: Record<ReleaseTarget, TargetInfo> = {
  "darwin-arm64": {
    bunAsset: "bun-darwin-aarch64.zip",
    sqlitePackage: "sqlite-vec-darwin-arm64",
    microsandboxPackage: "@superradcompany/microsandbox-darwin-arm64",
  },
  "linux-x64-gnu": {
    bunAsset: "bun-linux-x64.zip",
    sqlitePackage: "sqlite-vec-linux-x64",
    microsandboxPackage: "@superradcompany/microsandbox-linux-x64-gnu",
  },
  "linux-arm64-gnu": {
    bunAsset: "bun-linux-aarch64.zip",
    sqlitePackage: "sqlite-vec-linux-arm64",
    microsandboxPackage: "@superradcompany/microsandbox-linux-arm64-gnu",
  },
};

const BASE_NATIVE_PACKAGES = ["sqlite-vec", "microsandbox"];
const EXTERNAL_NATIVE_IMPORTS = ["sqlite-vec", "microsandbox"];

export function supportedReleaseTargets(): ReleaseTarget[] {
  return Object.keys(TARGETS) as ReleaseTarget[];
}

export function packagePlanForTarget(target: ReleaseTarget): PackagePlan {
  const info = targetInfo(target);
  return {
    target,
    appEntrypoint: "app/aithy.js",
    workerEntrypoints: [
      "app/workers/sandbox-worker.js",
      "app/workers/local-inference-worker.js",
    ],
    nativePackages: [...BASE_NATIVE_PACKAGES, info.sqlitePackage, info.microsandboxPackage],
    excludedServices: ["queue-service", "agent-worker"],
  };
}

export function nativeExternalImports(): string[] {
  return [...EXTERNAL_NATIVE_IMPORTS];
}

if (import.meta.main) {
  await main();
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const target = parseTarget(args.target);
  const packageName = args["package-name"] || args.packageName || `aithy-${packageJson.version}-${target}`;
  const outdir = path.resolve(args.outdir || "release");
  const packageRoot = path.join(outdir, packageName);

  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(path.join(packageRoot, "app/workers"), { recursive: true });
  await mkdir(path.join(packageRoot, "bin"), { recursive: true });

  await buildBundles(packageRoot);
  await cp("dist/client", path.join(packageRoot, "client"), { recursive: true });
  await installBunRuntime(target, path.join(packageRoot, "bin/bun"));
  await installNativePackages(target, path.join(packageRoot, "app/node_modules"));
  await writeLauncher(packageRoot);
  await writePackageReadme(packageRoot);
  await writeReleaseManifest(target, packageRoot);
  await verifyPackageContents(target, packageRoot);

  console.log(`Packaged ${packageName} at ${packageRoot}`);
}

async function buildBundles(packageRoot: string): Promise<void> {
  await run([
    process.execPath,
    "build",
    "packaging/serve-built.ts",
    "--target",
    "bun",
    "--minify",
    ...externalNativeBuildArgs(),
    "--outfile",
    path.join(packageRoot, "app/aithy.js"),
  ]);
  await run([
    process.execPath,
    "build",
    "src/runtime/services/sandbox/worker.ts",
    "--target",
    "bun",
    "--minify",
    ...externalNativeBuildArgs(),
    "--outfile",
    path.join(packageRoot, "app/workers/sandbox-worker.js"),
  ]);
  await run([
    process.execPath,
    "build",
    "src/runtime/services/local-inference/worker.ts",
    "--target",
    "bun",
    "--minify",
    ...externalNativeBuildArgs(),
    "--outfile",
    path.join(packageRoot, "app/workers/local-inference-worker.js"),
  ]);
}

async function installBunRuntime(target: ReleaseTarget, destination: string): Promise<void> {
  if (target === hostTarget()) {
    await cp(process.execPath, destination);
    await chmod(destination, 0o755);
    return;
  }

  const version = bunVersion();
  const asset = targetInfo(target).bunAsset;
  const tmpRoot = path.join("/tmp", `aithy-bun-${target}-${crypto.randomUUID()}`);
  const archive = path.join(tmpRoot, asset);
  await mkdir(tmpRoot, { recursive: true });
  await download(
    `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${asset}`,
    archive,
  );
  await run(["/usr/bin/unzip", "-q", archive, "-d", tmpRoot]);
  const binary = await findFile(tmpRoot, "bun");
  if (!binary) throw new Error(`Bun archive did not contain bun: ${asset}`);
  await cp(binary, destination);
  await chmod(destination, 0o755);
  await rm(tmpRoot, { recursive: true, force: true });
}

async function installNativePackages(target: ReleaseTarget, destinationRoot: string): Promise<void> {
  await mkdir(destinationRoot, { recursive: true });
  for (const packageName of packagePlanForTarget(target).nativePackages) {
    await installPackage(packageName, packageVersion(packageName), destinationRoot);
  }
}

async function installPackage(packageName: string, version: string, destinationRoot: string): Promise<void> {
  const localPath = path.join("node_modules", ...packageName.split("/"));
  const destination = path.join(destinationRoot, ...packageName.split("/"));
  await mkdir(path.dirname(destination), { recursive: true });
  if (await exists(localPath)) {
    await cp(localPath, destination, { recursive: true });
    return;
  }

  const tmpRoot = path.join("/tmp", `aithy-npm-${safeName(packageName)}-${crypto.randomUUID()}`);
  const archive = path.join(tmpRoot, "package.tgz");
  await mkdir(tmpRoot, { recursive: true });
  const metadata = await npmPackageMetadata(packageName, version);
  if (!metadata.dist?.tarball) throw new Error(`No npm tarball for ${packageName}@${version}`);
  await download(metadata.dist.tarball, archive);
  await run(["/usr/bin/tar", "-xzf", archive, "-C", tmpRoot]);
  await cp(path.join(tmpRoot, "package"), destination, { recursive: true });
  await rm(tmpRoot, { recursive: true, force: true });
}

async function writeLauncher(packageRoot: string): Promise<void> {
  const launcher = `#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$ROOT/bin/bun" "$ROOT/app/aithy.js" "$@"
`;
  const launcherPath = path.join(packageRoot, "aithy");
  await writeFile(launcherPath, launcher);
  await chmod(launcherPath, 0o755);
}

async function writePackageReadme(packageRoot: string): Promise<void> {
  await writeFile(path.join(packageRoot, "README.txt"), `Run Aithy with:

  ./aithy

The web UI binds to http://127.0.0.1:3000 by default. Use --host and --port
to choose another bind address.
`);
}

async function writeReleaseManifest(target: ReleaseTarget, packageRoot: string): Promise<void> {
  const manifest = {
    name: "aithy",
    version: packageJson.version,
    gitSha: process.env.GITHUB_SHA || await gitSha(),
    generatedAt: new Date().toISOString(),
    target,
    bunVersion: bunVersion(),
    topology: {
      web: "coordinator",
      queue: "coordinator",
      agent: "coordinator",
      sandbox: "process",
      localInference: "process",
    },
    entrypoints: {
      app: "app/aithy.js",
      sandboxWorker: "app/workers/sandbox-worker.js",
      localInferenceWorker: "app/workers/local-inference-worker.js",
    },
    nativePackages: packagePlanForTarget(target).nativePackages.map((name) => ({
      name,
      version: packageVersion(name),
    })),
  };
  await writeFile(path.join(packageRoot, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function verifyPackageContents(target: ReleaseTarget, packageRoot: string): Promise<void> {
  const required = [
    "aithy",
    "bin/bun",
    "app/aithy.js",
    "app/workers/sandbox-worker.js",
    "app/workers/local-inference-worker.js",
    "client",
    "release.json",
  ];
  for (const relative of required) {
    if (!(await exists(path.join(packageRoot, relative)))) throw new Error(`Missing package entry: ${relative}`);
  }
  for (const service of packagePlanForTarget(target).excludedServices) {
    const worker = path.join(packageRoot, "app/workers", `${service}.js`);
    if (await exists(worker)) throw new Error(`Unexpected packaged worker: ${worker}`);
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const [name, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[++i];
    if (!value) throw new Error(`--${name} requires a value`);
    args[name] = value;
  }
  return args;
}

function parseTarget(value: string | undefined): ReleaseTarget {
  if (value && supportedReleaseTargets().includes(value as ReleaseTarget)) return value as ReleaseTarget;
  throw new Error(`--target must be one of: ${supportedReleaseTargets().join(", ")}`);
}

function targetInfo(target: ReleaseTarget): TargetInfo {
  return TARGETS[target];
}

function externalNativeBuildArgs(): string[] {
  return EXTERNAL_NATIVE_IMPORTS.flatMap((name) => ["--external", name]);
}

function hostTarget(): ReleaseTarget | undefined {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64-gnu";
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64-gnu";
  return undefined;
}

function bunVersion(): string {
  const manager = packageJson.packageManager;
  if (!manager?.startsWith("bun@")) throw new Error("package.json packageManager must pin bun@<version>");
  return manager.slice("bun@".length);
}

function packageVersion(packageName: string): string {
  if (packageName.startsWith("sqlite-vec")) return packageJson.dependencies["sqlite-vec"];
  if (packageName === "microsandbox" || packageName.startsWith("@superradcompany/microsandbox")) {
    return packageJson.dependencies.microsandbox;
  }
  throw new Error(`No release package version resolver for ${packageName}`);
}

async function npmPackageMetadata(packageName: string, version: string): Promise<{ dist?: { tarball?: string } }> {
  const response = await fetch(`https://registry.npmjs.org/${encodePackageName(packageName)}/${version}`);
  if (!response.ok) throw new Error(`npm lookup failed for ${packageName}@${version}: HTTP ${response.status}`);
  return response.json() as Promise<{ dist?: { tarball?: string } }>;
}

function encodePackageName(packageName: string): string {
  return packageName.startsWith("@") ? packageName.replace("/", "%2f") : packageName;
}

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${url} HTTP ${response.status}`);
  await Bun.write(destination, response);
}

async function run(command: string[]): Promise<void> {
  const proc = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${command.join(" ")} exited with ${code}`);
}

async function findFile(root: string, basename: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === basename) return fullPath;
    if (entry.isDirectory()) {
      const found = await findFile(fullPath, basename);
      if (found) return found;
    }
  }
  return null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function gitSha(): Promise<string | null> {
  const proc = Bun.spawn(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "ignore" });
  if (await proc.exited !== 0) return null;
  return (await new Response(proc.stdout).text()).trim() || null;
}

function safeName(packageName: string): string {
  return packageName.replace(/[^a-z0-9.-]/gi, "-");
}
