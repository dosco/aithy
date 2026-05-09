import { getAithyRuntime } from "./runtime/aithy-runtime.server";

const runtime = await getAithyRuntime();

console.log(
  [
    "Aithy runtime initialized.",
    `State: ${runtime.config.stateDbPath}`,
    "Run `bun run start` to open the localhost web UI.",
  ].join("\n"),
);
