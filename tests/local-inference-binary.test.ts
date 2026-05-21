import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { resolveLlamaServerBinary, verifyLlamaServerBinary } from "../src/local-inference/binary";

describe("llama-server binary resolution", () => {
  test("verifies a compatible llama-server binary", async () => {
    const binary = await fakeBinary({ help: "--models-preset\n--models-max\n" });

    await expect(verifyLlamaServerBinary(binary)).resolves.toMatchObject({
      path: binary,
      version: "llama.cpp b9222",
    });
  });

  test("rejects an old binary without router flags", async () => {
    const binary = await fakeBinary({ help: "--model\n" });

    await expect(verifyLlamaServerBinary(binary)).rejects.toThrow(/missing --models-preset, --models-max/);
  });

  test("retries a transient SIGKILL during binary verification", async () => {
    const binary = await fakeBinary({ help: "--models-preset\n--models-max\n" });
    const originalSpawn = Bun.spawn;
    let calls = 0;
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((command: string[], options: unknown) => {
      calls += 1;
      if (calls === 1) {
        return {
          stdout: new Response("").body,
          stderr: new Response("").body,
          exited: Promise.resolve(137),
          kill: () => {},
        } as unknown as ReturnType<typeof Bun.spawn>;
      }
      return (originalSpawn as unknown as (command: string[], options: unknown) => ReturnType<typeof Bun.spawn>)(
        command,
        options,
      );
    }) as typeof Bun.spawn;

    try {
      await expect(verifyLlamaServerBinary(binary)).resolves.toMatchObject({
        path: binary,
        version: "llama.cpp b9222",
      });
      expect(calls).toBe(3);
    } finally {
      (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });

  test("uses saved settings path before managed download", async () => {
    const settingsBinary = await fakeBinary({ help: "--models-preset\n--models-max\n" });
    const stateRoot = await mkdtemp(path.join(tmpdir(), "aithy-llama-bin-"));
    const blockedFetch = Object.assign(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
        throw new Error("managed download should not run");
      },
      { preconnect: () => {} },
    ) as typeof fetch;

    const resolved = await resolveLlamaServerBinary({
      stateRoot,
      settingsPath: settingsBinary,
      fetchImpl: blockedFetch,
    });

    expect(resolved).toMatchObject({ path: settingsBinary, source: "settings" });
  });

  test("ignores env-shaped binary inputs", async () => {
    const envBinary = await fakeBinary({ help: "--models-preset\n--models-max\n" });
    const settingsBinary = await fakeBinary({ help: "--models-preset\n--models-max\n" });
    const stateRoot = await mkdtemp(path.join(tmpdir(), "aithy-llama-bin-"));

    const input = {
      stateRoot,
      env: { AITHY_LLAMA_SERVER_BIN: envBinary, PATH: path.dirname(envBinary) },
      settingsPath: settingsBinary,
    } as never as Parameters<typeof resolveLlamaServerBinary>[0];
    const resolved = await resolveLlamaServerBinary(input);

    expect(resolved).toMatchObject({ path: settingsBinary, source: "settings" });
  });

  test("uses the package-pinned managed release from cache without a release lookup", async () => {
    const packageRoot = await fakePackageRoot("b-test-pin");
    const stateRoot = await mkdtemp(path.join(tmpdir(), "aithy-llama-bin-"));
    const binary = await fakeBinaryAt(
      path.join(stateRoot, "local-inference", "llama.cpp", "b-test-pin", "llama-test"),
      { help: "--models-preset\n--models-max\n" },
    );
    const blockedFetch = Object.assign(
      async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
        throw new Error("cached pinned release should not hit the network");
      },
      { preconnect: () => {} },
    ) as typeof fetch;

    const resolved = await resolveLlamaServerBinary({
      stateRoot,
      packageRoot,
      fetchImpl: blockedFetch,
    });

    expect(resolved).toMatchObject({ path: binary, source: "managed" });
  });

  test("looks up the package-pinned managed release when cache is missing", async () => {
    const packageRoot = await fakePackageRoot("b-fetch-pin");
    const stateRoot = await mkdtemp(path.join(tmpdir(), "aithy-llama-bin-"));
    const urls: string[] = [];
    const fetchImpl = Object.assign(
      async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
        urls.push(String(input));
        return Response.json({ tag_name: "b-fetch-pin", assets: [] });
      },
      { preconnect: () => {} },
    ) as typeof fetch;

    await expect(resolveLlamaServerBinary({
      stateRoot,
      packageRoot,
      fetchImpl,
    })).rejects.toThrow(/llama-server was not found/);

    expect(urls[0]).toBe("https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b-fetch-pin");
  });

  test("ignores cached binaries from older managed release pins", async () => {
    const packageRoot = await fakePackageRoot("b-next-pin");
    const stateRoot = await mkdtemp(path.join(tmpdir(), "aithy-llama-bin-"));
    await fakeBinaryAt(
      path.join(stateRoot, "local-inference", "llama.cpp", "b-old-pin", "llama-test"),
      { help: "--models-preset\n--models-max\n" },
    );
    const urls: string[] = [];
    const fetchImpl = Object.assign(
      async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
        urls.push(String(input));
        return Response.json({ tag_name: "b-next-pin", assets: [] });
      },
      { preconnect: () => {} },
    ) as typeof fetch;

    await expect(resolveLlamaServerBinary({
      stateRoot,
      packageRoot,
      fetchImpl,
    })).rejects.toThrow(/llama-server was not found/);

    expect(urls[0]).toBe("https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b-next-pin");
  });
});

async function fakeBinary(input: { help: string }): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-fake-llama-"));
  return fakeBinaryAt(path.join(dir, "bin"), input);
}

async function fakeBinaryAt(binDir: string, input: { help: string }): Promise<string> {
  await mkdir(binDir, { recursive: true });
  const binary = path.join(binDir, "llama-server");
  await writeFile(binary, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then echo \"llama.cpp b9222\"; exit 0; fi",
    `if [ "$1" = "--help" ]; then printf '%s' '${input.help.replaceAll("'", "'\\''")}'; exit 0; fi`,
    "exit 1",
    "",
  ].join("\n"));
  await chmod(binary, 0o755);
  return binary;
}

async function fakePackageRoot(llamaCppRelease: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "aithy-package-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({
    aithy: { llamaCppRelease },
  }));
  return dir;
}
