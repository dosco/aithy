import path from "node:path";
import type { RuntimeServiceRole } from "./protocol/types";
import type { RuntimeTopology } from "./topology";

const packagedWorkerScripts: Partial<Record<RuntimeServiceRole, string>> = {
  "sandbox-worker": "sandbox-worker.js",
  "local-inference-worker": "local-inference-worker.js",
};

export function runtimeServiceCommand(input: {
  role: RuntimeServiceRole;
  sourceEntry: string;
  topology: RuntimeTopology;
}): { command: string[]; entry: string } {
  if (input.topology.kind === "packaged") {
    const script = packagedWorkerScripts[input.role];
    if (!script || !input.topology.serviceScriptRoot) {
      throw new Error(`No packaged service script configured for ${input.role}`);
    }
    const entry = path.join(input.topology.serviceScriptRoot, script);
    return { command: [process.execPath, entry], entry };
  }

  const entry = path.join(process.cwd(), input.sourceEntry);
  return { command: [process.execPath, "run", entry], entry };
}
