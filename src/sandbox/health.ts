import type { AppConfig } from "../config/env";
import type { SandboxBashResult, SandboxProvider } from "./provider";

export const SANDBOX_CAPABILITY_GROUPS = ["core", "python", "document", "media"] as const;
export type SandboxCapabilityGroup = typeof SANDBOX_CAPABILITY_GROUPS[number];

export interface SandboxCapabilityCheck {
  group: SandboxCapabilityGroup;
  ok: boolean;
  commands: string[];
  missingCommands: string[];
  pythonImports: string[];
  missingPythonImports: string[];
}

export interface SandboxHealthReport {
  status: "unknown" | "checking" | "ready" | "degraded" | "failed";
  provider: AppConfig["sandboxProvider"];
  selection: AppConfig["sandboxImageSelection"] | null;
  label: string | null;
  image: string;
  arch: string;
  network: AppConfig["sandboxNetwork"];
  cpus: number;
  memoryMb: number;
  sessionId: string | null;
  checkedAt: string | null;
  startedAt: string | null;
  durationMs: number | null;
  capabilities: SandboxCapabilityCheck[];
  lastError: string | null;
}

interface DoctorInput {
  provider: SandboxProvider;
  sessionId: string;
  config: AppConfig;
  startedAt?: string | null;
}

const GROUPS: Array<{
  group: SandboxCapabilityGroup;
  commands: string[];
  pythonImports: string[];
}> = [
  {
    group: "core",
    commands: ["bash", "sh", "ls", "cat", "cp", "mv", "rm", "mkdir", "sed", "awk", "find", "curl", "wget"],
    pythonImports: [],
  },
  {
    group: "python",
    commands: ["python3", "pip3"],
    pythonImports: ["bs4", "numpy", "openpyxl", "pandas", "PIL", "requests"],
  },
  {
    group: "document",
    commands: ["docling", "tesseract", "pdftotext", "pdfinfo", "pdftoppm", "pdfimages", "qpdf", "gs"],
    pythonImports: ["docling"],
  },
  {
    group: "media",
    commands: ["ffmpeg", "ffprobe", "mediainfo"],
    pythonImports: [],
  },
];

const DOCTOR_SCRIPT = `
import importlib.util, json, shutil, sys
groups = json.loads(sys.argv[1])
out = []
for item in groups:
    commands = item["commands"]
    imports = item["pythonImports"]
    missing_commands = [name for name in commands if shutil.which(name) is None]
    missing_imports = [name for name in imports if importlib.util.find_spec(name) is None]
    out.append({
        "group": item["group"],
        "commands": commands,
        "missingCommands": missing_commands,
        "pythonImports": imports,
        "missingPythonImports": missing_imports,
    })
print(json.dumps(out))
`;

export function initialSandboxHealth(config: AppConfig): SandboxHealthReport {
  return {
    status: "unknown",
    provider: config.sandboxProvider,
    selection: config.sandboxImageSelection ?? null,
    label: config.sandboxImageLabel ?? null,
    image: config.sandboxImage,
    arch: process.arch === "arm64" ? "arm64" : "amd64",
    network: config.sandboxNetwork,
    cpus: config.sandboxCpus,
    memoryMb: config.sandboxMemoryMb,
    sessionId: null,
    checkedAt: null,
    startedAt: null,
    durationMs: null,
    capabilities: capabilityChecksFromRaw([]),
    lastError: null,
  };
}

export async function runSandboxDoctor(input: DoctorInput): Promise<SandboxHealthReport> {
  const started = performance.now();
  const checkedAt = new Date().toISOString();
  const base = {
    ...initialSandboxHealth(input.config),
    status: "checking" as const,
    sessionId: input.sessionId,
    startedAt: input.startedAt ?? checkedAt,
    checkedAt,
  };
  try {
    const result = await input.provider.bash(input.sessionId, {
      command: `python3 -c ${shellQuote(DOCTOR_SCRIPT)} ${shellQuote(JSON.stringify(GROUPS))}`,
      timeoutProfile: "long",
      maxOutputChars: 40_000,
    });
    const checks = parseDoctorOutput(result);
    const failed = result.exitCode !== 0 || checks.some((check) => !check.ok);
    return {
      ...base,
      status: result.exitCode === 0 ? (failed ? "degraded" : "ready") : "failed",
      durationMs: Math.round(performance.now() - started),
      capabilities: checks,
      lastError: result.exitCode === 0 ? null : result.stderr || result.stdout || `doctor exited ${result.exitCode}`,
    };
  } catch (error) {
    return {
      ...base,
      status: "failed",
      durationMs: Math.round(performance.now() - started),
      capabilities: capabilityChecksFromRaw([]),
      lastError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function capabilityGroupsReady(health: SandboxHealthReport | null | undefined): SandboxCapabilityGroup[] {
  if (!health) return [];
  return health.capabilities.filter((check) => check.ok).map((check) => check.group);
}

export function missingCapabilitySummary(
  health: SandboxHealthReport | null | undefined,
  groups: readonly SandboxCapabilityGroup[],
): string[] {
  if (!health) return groups.map((group) => `${group}: sandbox health is unknown`);
  const byGroup = new Map(health.capabilities.map((check) => [check.group, check]));
  return groups.flatMap((group) => {
    const check = byGroup.get(group);
    if (!check) return [`${group}: capability was not checked`];
    if (check.ok) return [];
    const missing = [
      ...check.missingCommands.map((name) => `command ${name}`),
      ...check.missingPythonImports.map((name) => `python import ${name}`),
    ];
    return [`${group}: missing ${missing.join(", ")}`];
  });
}

function parseDoctorOutput(result: SandboxBashResult): SandboxCapabilityCheck[] {
  if (result.exitCode !== 0) return capabilityChecksFromRaw([]);
  try {
    const parsed = JSON.parse(result.stdout.trim()) as Array<{
      group: SandboxCapabilityGroup;
      commands: string[];
      missingCommands: string[];
      pythonImports: string[];
      missingPythonImports: string[];
    }>;
    return capabilityChecksFromRaw(parsed);
  } catch {
    return capabilityChecksFromRaw([]);
  }
}

function capabilityChecksFromRaw(raw: Array<{
  group: SandboxCapabilityGroup;
  commands: string[];
  missingCommands: string[];
  pythonImports: string[];
  missingPythonImports: string[];
}>): SandboxCapabilityCheck[] {
  const byGroup = new Map(raw.map((item) => [item.group, item]));
  return GROUPS.map(({ group, commands, pythonImports }) => {
    const item = byGroup.get(group);
    const missingCommands = item?.missingCommands ?? commands;
    const missingPythonImports = item?.missingPythonImports ?? pythonImports;
    return {
      group,
      ok: missingCommands.length === 0 && missingPythonImports.length === 0,
      commands,
      missingCommands,
      pythonImports,
      missingPythonImports,
    };
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
