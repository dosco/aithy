import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { DEFAULT_SANDBOX_IMAGE } from "../src/config/env";
import { MicrosandboxProvider } from "../src/sandbox/microsandbox-provider";

describe("MicrosandboxProvider", () => {
  test("bind-mounts the bot workspace and exposes user mounts at /mounts/<name>", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-msb-"));
    const workspacePath = path.join(root, "workspace");

    const fakeFactory = createFakeSandboxFactory();
    const provider = new MicrosandboxProvider({
      image: "python:3.11-slim",
      cpus: 1,
      memoryMb: 512,
      network: "none",
      sandboxFactory: fakeFactory as any
    });

    const session = await provider.createSession("default", workspacePath, [
      { hostPath: "/host/data", mountName: "data-aabbccdd" },
      { hostPath: "/host/scratch", mountName: "scratch-eeff0011" }
    ]);
    const created = fakeFactory.created[0];
    expect(created?.image).toBe("python:3.11-slim");
    expect(created?.network).toBe("none");
    expect(created?.publicPull).toBeUndefined();
    expect(created?.libkrunfwPath).toContain("libkrunfw");
    expect(created?.volumes).toEqual([
      { guest: "/workspace", host: workspacePath, readonly: false },
      { guest: "/outbox", host: path.join(workspacePath, "outbox"), readonly: false },
      { guest: "/mounts/data-aabbccdd", host: "/host/data", readonly: true },
      { guest: "/mounts/scratch-eeff0011", host: "/host/scratch", readonly: true }
    ]);
    expect(created?.envs).toEqual({});

    const bash = await provider.bash(session.id, { command: "echo hi", cwd: "/workspace" });
    expect(bash.exitCode).toBe(0);
    expect(bash.stdout).toContain("bash -lc");

    await provider.write(session.id, "/workspace/result.txt", "hello world");
    expect(await provider.read(session.id, "/workspace/result.txt")).toBe("hello world");

    // The host workspace directory exists, but no auto-subdirs (no inbox/out/mounts/_cache).
    const wsStat = await stat(workspacePath);
    expect(wsStat.isDirectory()).toBe(true);
    await expect(stat(path.join(workspacePath, "inbox"))).rejects.toThrow();
    await expect(stat(path.join(workspacePath, "_cache"))).rejects.toThrow();

    await provider.recreate(session.id, workspacePath, [
      { hostPath: "/host/data", mountName: "data-aabbccdd" }
    ]);
    expect(fakeFactory.created).toHaveLength(2);
    expect(fakeFactory.created[1]?.volumes).toEqual([
      { guest: "/workspace", host: workspacePath, readonly: false },
      { guest: "/outbox", host: path.join(workspacePath, "outbox"), readonly: false },
      { guest: "/mounts/data-aabbccdd", host: "/host/data", readonly: true }
    ]);

    await provider.destroy(session.id);
    expect(fakeFactory.instances[1]?.stopped).toBe(true);
  });

  test("park stops the VM but resume reuses persisted state without rebuilding", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-msb-park-"));
    const workspacePath = path.join(root, "workspace");
    const fakeFactory = createFakeSandboxFactory();
    const provider = new MicrosandboxProvider({
      image: "python:3.11-slim",
      cpus: 1,
      memoryMb: 512,
      network: "none",
      sandboxFactory: fakeFactory as any
    });

    const session = await provider.createSession("park-bot", workspacePath, []);
    const initialBuilds = fakeFactory.created.length;

    await provider.park(session.id);
    expect(fakeFactory.instances[0]?.stopped).toBe(true);

    // bash on a parked session should implicitly resume (no rebuild) and execute.
    const bash = await provider.bash(session.id, { command: "echo back", cwd: "/workspace" });
    expect(bash.exitCode).toBe(0);
    expect(fakeFactory.created.length).toBe(initialBuilds);
    expect(fakeFactory.instances[0]?.resumes).toBe(1);

    await provider.destroy(session.id);
  });

  test("destroy on a parked session removes the persisted DB record", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-msb-destroyparked-"));
    const workspacePath = path.join(root, "workspace");
    const fakeFactory = createFakeSandboxFactory();
    const provider = new MicrosandboxProvider({
      image: "python:3.11-slim",
      cpus: 1,
      memoryMb: 512,
      network: "none",
      sandboxFactory: fakeFactory as any
    });

    const session = await provider.createSession("destroy-parked", workspacePath, []);
    await provider.park(session.id);
    await provider.destroy(session.id);

    expect(fakeFactory.removed).toContain(session.id);
  });

  test("blocks when the configured sandbox image is not pullable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-msb-image-fail-"));
    const workspacePath = path.join(root, "workspace");
    const statuses: string[] = [];
    const fakeFactory = createFakeSandboxFactory({ failImages: new Set([DEFAULT_SANDBOX_IMAGE]) });
    const provider = new MicrosandboxProvider({
      image: DEFAULT_SANDBOX_IMAGE,
      cpus: 1,
      memoryMb: 512,
      network: "none",
      sandboxFactory: fakeFactory as any,
      onStatus: (status) => statuses.push(status.label),
    });

    await expect(provider.createSession("image-fail-bot", workspacePath, []))
      .rejects.toThrow("Failed to start Microsandbox microVM");

    expect(fakeFactory.created.map((item: FakeConfig) => item.image)).toEqual([
      DEFAULT_SANDBOX_IMAGE,
    ]);
    expect(fakeFactory.created[0]?.publicPull).toBe(true);
    expect(statuses.some((label) => label.includes("GHCR rejected the anonymous public pull"))).toBe(true);
  });

  test("retries Aithy arch tags with latest when GHCR has not published the tag yet", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "aithy-msb-image-fallback-"));
    const workspacePath = path.join(root, "workspace");
    const configuredImage = "ghcr.io/dosco/aithy-sandbox:latest-arm64";
    const statuses: string[] = [];
    const fakeFactory = createFakeSandboxFactory({
      failImages: new Map([[configuredImage, "image error: registry error: manifest unknown"]]),
    });
    const provider = new MicrosandboxProvider({
      image: configuredImage,
      cpus: 1,
      memoryMb: 512,
      network: "none",
      sandboxFactory: fakeFactory as any,
      onStatus: (status) => statuses.push(status.label),
    });

    await provider.createSession("image-fallback-bot", workspacePath, []);

    expect(fakeFactory.created.map((item: FakeConfig) => item.image)).toEqual([
      configuredImage,
      "ghcr.io/dosco/aithy-sandbox:latest",
    ]);
    expect(statuses).toContain("sandbox image tag missing; retrying ghcr.io/dosco/aithy-sandbox:latest");
  });
});

interface FakeConfig {
  name: string;
  image?: string;
  cpus?: number;
  memory?: number;
  network?: string;
  publicPull?: boolean;
  libkrunfwPath?: string;
  volumes: Array<{ guest: string; host: string; readonly: boolean }>;
  envs: Record<string, string>;
}

function createFakeSandboxFactory(options: { failImages?: Set<string> | Map<string, string> } = {}) {
  const created: FakeConfig[] = [];
  const instances: FakeSandbox[] = [];
  const byName = new Map<string, FakeSandbox>();
  const removed: string[] = [];
  const factory: any = {
    created,
    instances,
    byName,
    removed,
    async get(name: string) {
      const stored = byName.get(name);
      if (!stored) throw new Error(`no persisted sandbox named ${name}`);
      return {
        async start() { return stored.start(); },
        async startDetached() { return stored.start(); },
      };
    },
    async remove(name: string) {
      removed.push(name);
      byName.delete(name);
    },
    builder(name: string) {
      const config: FakeConfig = { name, volumes: [], envs: {} };
      const builder: any = {
        image(value: string) { config.image = value; return builder; },
        cpus(value: number) { config.cpus = value; return builder; },
        memory(value: number) { config.memory = value; return builder; },
        replace() { return builder; },
        registry(configure: (b: any) => any) {
          configure({
            auth(auth: { kind: string }) {
              config.publicPull = auth.kind === "anonymous";
              return this;
            }
          });
          return builder;
        },
        libkrunfwPath(value: string) { config.libkrunfwPath = value; return builder; },
        env(key: string, value: string) { config.envs[key] = value; return builder; },
        envs(vars: Record<string, string>) { Object.assign(config.envs, vars); return builder; },
        network(configure: (b: any) => any) {
          configure({
            policy(policy: unknown) {
              config.network = (policy as { defaultEgress?: string }).defaultEgress === "deny" ? "none" : "custom";
              return this;
            }
          });
          return builder;
        },
        volume(guest: string, configure: (b: any) => any) {
          let host = "";
          let readonly = false;
          configure({
            bind(value: string) {
              host = value;
              return {
                readonly() { readonly = true; return this; },
              };
            }
          });
          config.volumes.push({ guest, host, readonly });
          return builder;
        },
        async create() {
          created.push(config);
          if (config.image && options.failImages?.has(config.image)) {
            const failure = options.failImages instanceof Map
              ? options.failImages.get(config.image)
              : "image error: registry error: Not authorized: url https://ghcr.io/v2/dosco/aithy-sandbox/manifests/latest";
            throw new Error(failure);
          }
          const sandbox = new FakeSandbox(name);
          instances.push(sandbox);
          byName.set(name, sandbox);
          return sandbox;
        }
      };
      return builder;
    }
  };
  return factory;
}

class FakeSandbox {
  readonly files = new Map<string, string>();
  stopped = false;
  resumes = 0;

  constructor(public readonly name: string = "fake") {}

  async exec(cmd: string, args: string[] = []) {
    return {
      code: 0,
      stdout: () => `${cmd} ${args.join(" ")}`,
      stderr: () => ""
    };
  }

  fs() {
    return {
      readToString: async (filePath: string) => this.files.get(filePath) ?? "",
      write: async (filePath: string, content: string) => {
        this.files.set(filePath, content);
      }
    };
  }

  async stopAndWait() {
    this.stopped = true;
    return { code: 0 };
  }

  async removePersisted() {}

  // Used by the fake `Sandbox.get(name).startDetached()` path.
  start(): FakeSandbox {
    this.stopped = false;
    this.resumes += 1;
    return this;
  }
}
