const packageJsonPath = "package.json";
const bunfigPath = "bunfig.toml";
const bunLockPath = "bun.lock";
const alternateLocks = ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"];
const trustedDependencyAllowlist = new Set(["bun", "protobufjs", "sharp"]);
const minimumReleaseAgeSeconds = 604800;

const tanStackAffectedVersions: Record<string, string[]> = {
  "@tanstack/arktype-adapter": ["1.166.12", "1.166.15"],
  "@tanstack/eslint-plugin-router": ["1.161.9", "1.161.12"],
  "@tanstack/eslint-plugin-start": ["0.0.4", "0.0.7"],
  "@tanstack/history": ["1.161.9", "1.161.12"],
  "@tanstack/nitro-v2-vite-plugin": ["1.154.12", "1.154.15"],
  "@tanstack/react-router": ["1.169.5", "1.169.8"],
  "@tanstack/react-router-devtools": ["1.166.16", "1.166.19"],
  "@tanstack/react-router-ssr-query": ["1.166.15", "1.166.18"],
  "@tanstack/react-start": ["1.167.68", "1.167.71"],
  "@tanstack/react-start-client": ["1.166.51", "1.166.54"],
  "@tanstack/react-start-rsc": ["0.0.47", "0.0.50"],
  "@tanstack/react-start-server": ["1.166.55", "1.166.58"],
  "@tanstack/router-cli": ["1.166.46", "1.166.49"],
  "@tanstack/router-core": ["1.169.5", "1.169.8"],
  "@tanstack/router-devtools": ["1.166.16", "1.166.19"],
  "@tanstack/router-devtools-core": ["1.167.6", "1.167.9"],
  "@tanstack/router-generator": ["1.166.45", "1.166.48"],
  "@tanstack/router-plugin": ["1.167.38", "1.167.41"],
  "@tanstack/router-ssr-query-core": ["1.168.3", "1.168.6"],
  "@tanstack/router-utils": ["1.161.11", "1.161.14"],
  "@tanstack/router-vite-plugin": ["1.166.53", "1.166.56"],
  "@tanstack/solid-router": ["1.169.5", "1.169.8"],
  "@tanstack/solid-router-devtools": ["1.166.16", "1.166.19"],
  "@tanstack/solid-router-ssr-query": ["1.166.15", "1.166.18"],
  "@tanstack/solid-start": ["1.167.65", "1.167.68"],
  "@tanstack/solid-start-client": ["1.166.50", "1.166.53"],
  "@tanstack/solid-start-server": ["1.166.54", "1.166.57"],
  "@tanstack/start-client-core": ["1.168.5", "1.168.8"],
  "@tanstack/start-fn-stubs": ["1.161.9", "1.161.12"],
  "@tanstack/start-plugin-core": ["1.169.23", "1.169.26"],
  "@tanstack/start-server-core": ["1.167.33", "1.167.36"],
  "@tanstack/start-static-server-functions": ["1.166.44", "1.166.47"],
  "@tanstack/start-storage-context": ["1.166.38", "1.166.41"],
  "@tanstack/valibot-adapter": ["1.166.12", "1.166.15"],
  "@tanstack/virtual-file-routes": ["1.161.10", "1.161.13"],
  "@tanstack/vue-router": ["1.169.5", "1.169.8"],
  "@tanstack/vue-router-devtools": ["1.166.16", "1.166.19"],
  "@tanstack/vue-router-ssr-query": ["1.166.15", "1.166.18"],
  "@tanstack/vue-start": ["1.167.61", "1.167.64"],
  "@tanstack/vue-start-client": ["1.166.46", "1.166.49"],
  "@tanstack/vue-start-server": ["1.166.50", "1.166.53"],
  "@tanstack/zod-adapter": ["1.166.12", "1.166.15"],
};

const tanStackIocs = [
  "@tanstack/setup",
  "79ac49eedf774dd4b0cfa308722bc463cfe5885c",
  "router_init.js",
  "tanstack_runner.js",
  "filev2.getsession.org",
  "seed1.getsession.org",
  "seed2.getsession.org",
  "seed3.getsession.org",
  "h8nc9u.js",
  "7rrc6l.mjs",
];

const failures: string[] = [];
const warnings: string[] = [];

await checkPackagePolicy();
await checkPinnedDependencies();
await checkPinnedVersionsMatchLock();
await checkBunInstallPolicy();
await checkLocks();
await checkTanStackLock();
await checkTextIocs([packageJsonPath, bunLockPath]);
await checkGithubWorkflows();

for (const warning of warnings) console.warn(`warning: ${warning}`);

if (failures.length > 0) {
  for (const failure of failures) console.error(`supply-chain check failed: ${failure}`);
  process.exit(1);
}

console.log("supply-chain checks passed");

async function checkPackagePolicy(): Promise<void> {
  const packageJson = JSON.parse(await Bun.file(packageJsonPath).text()) as PackageJson;
  const trusted = packageJson.trustedDependencies ?? [];

  for (const dependency of trusted) {
    if (!trustedDependencyAllowlist.has(dependency)) {
      failures.push(`${dependency} is trusted to run install scripts but is not in the reviewed allowlist`);
    }
  }
}

async function checkPinnedDependencies(): Promise<void> {
  const packageJson = JSON.parse(await Bun.file(packageJsonPath).text()) as PackageJson;
  const dependencyGroups = [
    ["dependencies", packageJson.dependencies],
    ["devDependencies", packageJson.devDependencies],
    ["optionalDependencies", packageJson.optionalDependencies],
    ["overrides", packageJson.overrides],
  ] as const;

  for (const [group, dependencies] of dependencyGroups) {
    for (const [name, version] of Object.entries(dependencies ?? {})) {
      if (!isPinnedVersion(version)) {
        failures.push(`${group}.${name} must be pinned to an exact version, found ${version}`);
      }
    }
  }
}

async function checkLocks(): Promise<void> {
  if (!(await exists(bunLockPath))) {
    failures.push("bun.lock is missing; install with bun and commit the lockfile");
  }

  for (const path of alternateLocks) {
    if (await exists(path)) {
      failures.push(`${path} is present; this repo should have a single Bun lockfile`);
    }
  }
}

async function checkBunInstallPolicy(): Promise<void> {
  if (!(await exists(bunfigPath))) {
    failures.push("bunfig.toml is missing; configure install.minimumReleaseAge");
    return;
  }

  const config = await Bun.file(bunfigPath).text();
  const installSection = readTomlSection(config, "install");
  if (installSection === undefined) {
    failures.push("bunfig.toml is missing the [install] section");
    return;
  }

  const minimumReleaseAge = readTomlInteger(installSection, "minimumReleaseAge");
  if (minimumReleaseAge === undefined) {
    failures.push("bunfig.toml [install].minimumReleaseAge is missing");
  } else if (minimumReleaseAge < minimumReleaseAgeSeconds) {
    failures.push(`bunfig.toml [install].minimumReleaseAge must be at least ${minimumReleaseAgeSeconds}`);
  }

  if (/^\s*minimumReleaseAgeExcludes\s*=/m.test(installSection)) {
    failures.push("bunfig.toml minimumReleaseAgeExcludes must not be used without a reviewed allowlist");
  }
}

async function checkPinnedVersionsMatchLock(): Promise<void> {
  if (!(await exists(bunLockPath))) return;

  const packageJson = JSON.parse(await Bun.file(packageJsonPath).text()) as PackageJson;
  const lockText = await Bun.file(bunLockPath).text();
  const dependencyGroups = [
    ["dependencies", packageJson.dependencies],
    ["devDependencies", packageJson.devDependencies],
    ["optionalDependencies", packageJson.optionalDependencies],
  ] as const;

  for (const [group, dependencies] of dependencyGroups) {
    for (const [name, version] of Object.entries(dependencies ?? {})) {
      const lockedVersion = readLockedVersion(lockText, name);
      if (lockedVersion === undefined) {
        failures.push(`${group}.${name} is missing from bun.lock`);
      } else if (lockedVersion !== version) {
        failures.push(`${group}.${name} is pinned to ${version} but bun.lock resolves ${lockedVersion}`);
      }
    }
  }
}

async function checkTanStackLock(): Promise<void> {
  if (!(await exists(bunLockPath))) return;

  const lockText = await Bun.file(bunLockPath).text();
  for (const [name, versions] of Object.entries(tanStackAffectedVersions)) {
    for (const version of versions) {
      if (lockText.includes(`"${name}": ["${name}@${version}"`)) {
        failures.push(`${name}@${version} is one of the TanStack compromised versions`);
      }
    }
  }
}

async function checkTextIocs(paths: string[]): Promise<void> {
  for (const path of paths) {
    if (!(await exists(path))) continue;
    const text = await Bun.file(path).text();
    for (const ioc of tanStackIocs) {
      if (text.includes(ioc)) failures.push(`${path} contains TanStack incident IOC ${ioc}`);
    }
  }
}

async function checkGithubWorkflows(): Promise<void> {
  const workflowPaths = await collectFiles(".github/workflows");
  for (const path of workflowPaths) {
    const text = await Bun.file(path).text();
    if (text.includes("pull_request_target")) {
      failures.push(`${path} uses pull_request_target; use pull_request unless the workflow is audited`);
    }
    if (text.includes("id-token: write") && text.includes("actions/cache")) {
      failures.push(`${path} combines id-token: write with actions/cache; isolate publish credentials from caches`);
    }
  }
}

async function collectFiles(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];

  const files: string[] = [];
  const glob = new Bun.Glob(`${root}/**/*`);
  for await (const file of glob.scan(".")) {
    if ((await Bun.file(file).stat()).isFile()) files.push(file);
  }
  return files.sort();
}

async function exists(path: string): Promise<boolean> {
  return await Bun.file(path).exists();
}

function isPinnedVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

function readLockedVersion(lockText: string, name: string): string | undefined {
  const escapedName = escapeRegExp(name);
  const pattern = new RegExp(`"${escapedName}": \\["(?:${escapedName}@)?([^"@]+)"`);
  return lockText.match(pattern)?.[1];
}

function readTomlSection(config: string, sectionName: string): string | undefined {
  const lines = config.split("\n");
  const sectionLines: string[] = [];
  let inSection = false;

  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header !== null) {
      if (inSection) break;
      inSection = header[1] === sectionName;
      continue;
    }

    if (inSection) sectionLines.push(line);
  }

  return inSection ? sectionLines.join("\n") : undefined;
}

function readTomlInteger(section: string, key: string): number | undefined {
  const escapedKey = escapeRegExp(key);
  const match = section.match(new RegExp(`^\\s*${escapedKey}\\s*=\\s*(\\d+)\\s*$`, "m"));
  return match === null ? undefined : Number(match[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
  trustedDependencies?: string[];
}

export {};
