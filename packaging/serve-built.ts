import { stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };
import { configureRuntimeTopology } from "../src/runtime/topology";

type ServerEntry = {
  default: {
    fetch(request: Request, server: Bun.Server): Response | Promise<Response>;
  };
};

const args = parseArgs(Bun.argv.slice(2));

if (args.help) {
  console.log(`Aithy ${packageJson.version}

Usage: aithy [--host <host>] [--port <port>]

Options:
  --host <host>   Bind address. Defaults to 127.0.0.1.
  --port <port>   Bind port. Defaults to 3000.
  --version       Print the packaged Aithy version.
  --help          Show this help.
`);
  process.exit(0);
}

if (args.version) {
  console.log(packageJson.version);
  process.exit(0);
}

const packageRoot = await resolvePackageRoot();
await configurePackagedTopology(packageRoot);

const clientRoot = await resolveClientRoot();
const app = ((await import("../dist/server/server.js")) as ServerEntry).default;
const server = Bun.serve({
  hostname: args.host,
  idleTimeout: 120,
  port: args.port,
  async fetch(request, bunServer) {
    const staticResponse = await serveClientAsset(clientRoot, new URL(request.url).pathname);
    if (staticResponse) return staticResponse;
    return app.fetch(request, bunServer);
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.stop(true);
    process.exit(0);
  });
}

console.log(`Aithy ${packageJson.version} listening on http://${server.hostname}:${server.port}`);

interface Args {
  help: boolean;
  host: string;
  port: number;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { help: false, host: "127.0.0.1", port: 3000, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const [name, inlineValue] = arg.split("=", 2);
    if (name === "--help" || name === "-h") args.help = true;
    else if (name === "--version" || name === "-v") args.version = true;
    else if (name === "--host") args.host = valueFor(argv, ++i, inlineValue, "--host");
    else if (name === "--port") args.port = parsePort(valueFor(argv, ++i, inlineValue, "--port"));
    else throw new Error(`Unknown option: ${arg}`);
    if (inlineValue !== undefined) i -= 1;
  }
  return args;
}

function valueFor(argv: string[], index: number, inlineValue: string | undefined, name: string): string {
  const value = inlineValue ?? argv[index];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

async function resolveClientRoot(): Promise<string> {
  for (const candidate of [
    resolve(packageRoot, "client"),
    resolve(process.cwd(), "client"),
    resolve(process.cwd(), "dist/client"),
  ]) {
    if (await isDirectory(candidate)) return candidate;
  }
  throw new Error("Could not find built client assets. Expected ./client beside the aithy binary.");
}

async function resolvePackageRoot(): Promise<string> {
  const entryDir = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    resolve(entryDir, ".."),
    resolve(dirname(process.execPath), ".."),
    process.cwd(),
  ]) {
    if (await isDirectory(resolve(candidate, "client"))) return candidate;
  }
  return resolve(entryDir, "..");
}

async function configurePackagedTopology(root: string): Promise<void> {
  const workersRoot = resolve(root, "app/workers");
  if (!(await isDirectory(workersRoot))) return;
  configureRuntimeTopology({ kind: "packaged", serviceScriptRoot: workersRoot });
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function serveClientAsset(clientRoot: string, pathname: string): Promise<Response | null> {
  const assetPath = safeAssetPath(clientRoot, pathname);
  if (!assetPath) return null;
  const file = Bun.file(assetPath);
  if (!(await file.exists())) return null;
  return new Response(file, {
    headers: { "content-type": contentType(assetPath) },
  });
}

function safeAssetPath(clientRoot: string, pathname: string): string | null {
  if (pathname === "/" || pathname.endsWith("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const assetPath = resolve(clientRoot, decoded.replace(/^\/+/, ""));
  return assetPath === clientRoot || assetPath.startsWith(`${clientRoot}${sep}`) ? assetPath : null;
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}
