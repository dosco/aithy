const args = Bun.argv.slice(2);

if (args.length === 0) {
  console.error("usage: bun run scripts/start-web.ts <vite-command> [...args]");
  process.exit(1);
}

const child = Bun.spawn(["bun", "--bun", "vite", ...args], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

process.exit(await child.exited);

export {};
