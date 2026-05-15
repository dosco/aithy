# Headless Aithy CLI For Smithers AgentLike

Status: design proposal only. This is not implemented.

## Source Basis

This contract is based on the current Aithy runtime path:

- `src/agent/run-message.ts` is the turn runner. It builds tool context, creates the Ax agent, emits events, persists transcript messages, and returns final assistant text.
- `src/agent/create-agent.ts` builds the Aithy Ax program with responder soul guidance, sandbox instructions, tools, memory recall, skill search, and function-call tracing.
- `src/agent/tools/index.ts` exposes `sandbox.*`, optional `system.bash`, web search/fetch, memory, and mount tools.
- `src/config/env.ts`, `src/settings/resolve.ts`, and `src/runtime/resolve-effective-config.ts` define bot id, state dir, workspace root, model settings, sandbox mode, and secrets.
- `src/session/session-manager.ts` and SQLite session state make transcripts durable by logical session id.
- `src/runtime/aithy-runtime.server.ts` and `src/runtime/services/*` are web/worker oriented and should not be required for headless Smithers runs.

The Smithers side is based on `@smithers-orchestrator/agents/src`:

- `AgentLike.generate()` accepts `prompt` or `messages`, `rootDir`, `timeout`, `abortSignal`, `maxOutputBytes`, `onStdout`, `onStderr`, `onEvent`, `resumeSession`, and `outputSchema`.
- `BaseCliAgent` already knows how to spawn a CLI, enforce process timeouts/abort signals, parse JSON or stream-json output, call `onStdout`/`onStderr`, and return an AI SDK-shaped generate result.
- Existing `CodexAgent`, `ClaudeCodeAgent`, and `PiAgent` wrappers all prefer machine-readable CLI modes and map task `outputSchema` into the underlying CLI when possible.

## 1. Recommended Command Surface

Smallest required surface:

```bash
aithy run --prompt "Summarize this repo" --cwd /path/to/repo --json
aithy run --prompt-file - --cwd /path/to/repo --output-format stream-json
aithy capabilities --json
aithy doctor --json
```

Canonical run command:

```bash
aithy run \
  --prompt-file - \
  --cwd /Users/ben/code/example \
  --workspace /Users/ben/code/example \
  --state-dir /tmp/smithers-aithy-state \
  --bot-id smithers-main \
  --adapter-profile smithers \
  --provider openai \
  --session task-01 \
  --model gpt-5.5 \
  --api-key-env OPENAI_API_KEY \
  --sandbox disabled \
  --system-bash disabled \
  --output-format stream-json \
  --output-schema /tmp/task-output.schema.json \
  --timeout-ms 600000
```

First-guess aliases should work:

- `aithy run` is canonical.
- `aithy agent run` aliases `aithy run`.
- `aithy exec` aliases `aithy run`.
- Bare `aithy` prints help and exits. It must not start the web UI or block in a TUI.

Required flags:

| Flag | Meaning |
| --- | --- |
| `--prompt <text>` | Inline user task. Mutually exclusive with `--prompt-file`. |
| `--prompt-file <path|->` | Read task text from file or stdin. Smithers should use `-`. |
| `--cwd <path>` | Host working directory for the task. Must be explicit in Smithers wrapper calls. |
| `--workspace <path>` | Host path mapped to Aithy's `/workspace`. Defaults to `--cwd` in headless mode. |
| `--state-dir <path>` | Root for SQLite state, traces, runtime cache, and workspace metadata. |
| `--bot-id <id>` | Aithy bot namespace under `--state-dir`. |
| `--adapter-profile <name>` | Adapter-owned settings namespace for Smithers runs. This is not the user profile prompt context and is not the agent soul itself. |
| `--profile <name>` | Alias for `--adapter-profile`, accepted for first-guess ergonomics but not used in Smithers examples. |
| `--session <id>` | Logical transcript id. If omitted, create an ephemeral id and return it as `resume`. |
| `--provider <name>` | Provider override for this run. Defaults to stored settings only when explicitly allowed by the caller. |
| `--model <model>` | Model override for this run. `--model openai:gpt-5.5` may be accepted as shorthand for `--provider openai --model gpt-5.5`. |
| `--api-key-env <name>` | Read the provider API key from this environment variable. The key is never printed. If omitted, use an existing Aithy stored secret or fail with `config_error`; do not infer model settings from env vars. |
| `--sandbox <microsandbox|disabled>` | Runtime execution mode. Smithers default should be explicit, not inherited. |
| `--system-bash <enabled|disabled>` | Whether `system.bash` can ever request host approval. Smithers default: `disabled`. |
| `--output-format <json|stream-json>` | Single final JSON or NDJSON event stream. |
| `--json` | Alias for `--output-format json`. |
| `--output-schema <path>` | JSON Schema for required structured output. |
| `--timeout-ms <n>` | Internal run budget. Smithers still enforces process timeout too. |
| `--max-output-bytes <n>` | Hard cap for emitted machine output. Must preserve valid JSON or fail. |
| `--no-web` | Default for `run`; fails if the run would need the web setup flow. |

Nice-to-have but not first implementation:

```bash
aithy sessions list --state-dir ... --bot-id ... --json
aithy sessions export <id> --state-dir ... --bot-id ... --json
```

`aithy capabilities --json` should return a Smithers-readable contract:

```json
{
  "schemaVersion": "aithy.capabilities.v1",
  "engine": "aithy",
  "commands": ["run", "capabilities", "doctor"],
  "outputFormats": ["json", "stream-json"],
  "events": ["started", "action", "completed"],
  "supportsOutputSchema": true,
  "supportsResumeSession": true,
  "supportsAbort": true,
  "runFlags": [
    "--prompt",
    "--prompt-file",
    "--cwd",
    "--workspace",
    "--state-dir",
    "--bot-id",
    "--adapter-profile",
    "--profile",
    "--session",
    "--provider",
    "--model",
    "--api-key-env",
    "--sandbox",
    "--system-bash",
    "--output-format",
    "--json",
    "--output-schema",
    "--timeout-ms",
    "--max-output-bytes",
    "--no-web"
  ],
  "sandboxModes": ["disabled", "microsandbox"],
  "state": ["stateDir", "botId", "adapterProfile", "session", "workspace"],
  "model": {
    "overrideFlags": ["--provider", "--model", "--api-key-env"],
    "modelEnvVars": false
  },
  "exitCodes": {
    "0": "ok",
    "1": "usage_error",
    "2": "config_error",
    "3": "state_error",
    "4": "sandbox_error",
    "5": "model_error",
    "6": "tool_error",
    "7": "timeout",
    "8": "schema_error",
    "9": "aborted",
    "10": "internal_error"
  }
}
```

## 2. JSON And NDJSON Output Contracts

Stdout is machine data only. Stderr is diagnostics only. No banners, progress text, ANSI color, setup links, or warnings may appear on stdout.

### `--output-format json`

Stdout is exactly one JSON object:

```json
{
  "schemaVersion": "aithy.agent.run.v1",
  "ok": true,
  "engine": "aithy",
  "model": "openai:gpt-5.5",
  "sessionId": "task-01",
  "resume": "task-01",
  "text": "Final assistant response.",
  "output": { "summary": "Structured data when --output-schema is supplied." },
  "usage": {
    "inputTokens": 123,
    "outputTokens": 45,
    "totalTokens": 168
  },
  "toolCalls": [
    {
      "id": "tool-1",
      "name": "sandbox.bash",
      "argsPreview": { "command": "ls" },
      "ok": true
    }
  ]
}
```

For successful non-schema runs, `output` is `null`. For schema runs, `output` is required and must validate before exit `0`.

### `--output-format stream-json`

Stdout is newline-delimited JSON. Every line parses as a Smithers-compatible `AgentCliEvent`. The final `completed` event may include an Aithy `result` extension so the wrapper can recover the final envelope without scraping text:

```json
{"type":"started","engine":"aithy","title":"Aithy run started","resume":"task-01","detail":{"sessionId":"task-01","cwd":"/repo"}}
{"type":"action","engine":"aithy","phase":"started","action":{"id":"tool-1","kind":"command","title":"sandbox.bash","detail":{"command":"ls"}}}
{"type":"action","engine":"aithy","phase":"completed","action":{"id":"tool-1","kind":"command","title":"sandbox.bash"},"ok":true}
{"type":"completed","engine":"aithy","ok":true,"answer":"Final assistant response.","resume":"task-01","usage":{"inputTokens":123,"outputTokens":45},"result":{"schemaVersion":"aithy.agent.run.v1","ok":true,"text":"Final assistant response.","output":null}}
```

Required event rules:

- The final line is always `type:"completed"` on success or handled failure.
- Tool events map Aithy tool names to Smithers action kinds: shell tools are `command`, memory/web tools are `tool` or `web_search`, file edits are `file_change`, reasoning/progress is `reasoning` or `note`.
- Diagnostics remain on stderr, even in stream mode.
- The Smithers wrapper must implement `createOutputInterpreter()` for this format. `BaseCliAgent` does not automatically forward arbitrary NDJSON lines to `onEvent`.
- If output exceeds `--max-output-bytes`, exit non-zero with a deterministic stderr diagnostic rather than truncating JSON into invalid bytes.

## 3. Exit-Code Contract

| Code | Name | Meaning |
| --- | --- | --- |
| `0` | `ok` | Run completed and final JSON/schema validation succeeded. |
| `1` | `usage_error` | Invalid command, flag, or incompatible flags. Stderr includes the exact corrected command. |
| `2` | `config_error` | Missing or invalid model/provider/API key/settings. No web setup flow is launched. |
| `3` | `state_error` | State dir, adapter profile, session, or SQLite lock/conflict failure. |
| `4` | `sandbox_error` | Sandbox could not start, mount, or execute required operations. |
| `5` | `model_error` | Provider/upstream model failure after Aithy formed a valid request. |
| `6` | `tool_error` | A required internal tool failed before the agent could recover. |
| `7` | `timeout` | `--timeout-ms` or Smithers process timeout expired. |
| `8` | `schema_error` | Final `output` was missing or failed `--output-schema` validation. |
| `9` | `aborted` | Abort signal or SIGTERM cancelled the run. |
| `10` | `internal_error` | Unexpected Aithy bug. Stderr includes a trace id, not a stack dump by default. |

`capabilities --json` must publish this same dictionary.

## 4. State, Profile, And Workspace Isolation

Smithers runs should not inherit the user's interactive Aithy state by default.

Recommended Smithers defaults:

- `--state-dir <smithers-run-or-project-cache>/aithy`
- `--bot-id <agent-id-or-workflow-agent-name>`
- `--adapter-profile smithers`
- `--session <task-attempt-id>` for a new task, or `--session <resumeSession>` when Smithers passes one.
- `--workspace <rootDir>` and `--cwd <rootDir>` so Aithy's `/workspace` is the Smithers task root.
- `--system-bash disabled` unless a workflow author explicitly opts in.
- `--sandbox disabled` for first implementation only if Smithers already controls the local workspace and accepts host execution. Use `microsandbox` later when mount semantics are reviewed.

State policy:

- `--state-dir` owns SQLite state, transcripts, soul/profile fields, traces, runtime caches, and default workspace metadata.
- `--workspace` owns task files and should be separate from `--state-dir`.
- `--adapter-profile` names Smithers-managed settings defaults inside the selected `--bot-id`. It must not silently import the interactive setup user profile, profile images, or soul fields.
- Transcript persistence is opt-in through `--session`/`resumeSession`. If no session is supplied, Aithy may persist under an ephemeral generated id but must return `resume`.
- Slash commands must be routed locally before agent execution. `/help`, `/skills`, and `/session` must never be forwarded as task prompts.

## 5. Smithers `AgentLike.generate` Mapping

| Smithers option | Aithy CLI mapping |
| --- | --- |
| `prompt` | stdin passed to `--prompt-file -`. |
| `messages` | Wrapper flattens via Smithers/BaseCliAgent prompt extraction, preserving system text separately. |
| `rootDir` | `--cwd <rootDir>` and default `--workspace <rootDir>`. |
| constructor `cwd` | Fallback for `rootDir`. |
| constructor `model` | `--model <model>` unless overridden in `AithyAgent` options. If the value is `provider:model`, either split it into `--provider` and `--model` or pass the accepted shorthand. |
| wrapper `provider` | `--provider <provider>`. |
| wrapper `apiKeyEnv` | `--api-key-env <env-var-name>`. Prefer this over embedding secrets in args. |
| `timeout.totalMs` | Process timeout plus `--timeout-ms`. |
| `timeout.idleMs` | Process idle timeout in Smithers wrapper; optional future `--idle-timeout-ms`. |
| `abortSignal` | Passed to spawned process. Aithy handles SIGTERM/SIGINT and exits `9`. |
| `maxOutputBytes` | Smithers process cap plus optional `--max-output-bytes`. |
| `onStdout` | Receives final text extracted from JSON/NDJSON by BaseCliAgent. |
| `onStderr` | Receives diagnostics chunks from stderr. |
| `onEvent` | Use `--output-format stream-json`; wrapper forwards parsed Aithy events through `createOutputInterpreter()`. |
| `resumeSession` | `--session <resumeSession>`. |
| `outputSchema` | Convert Zod to JSON Schema file and pass `--output-schema <file>`. |

The wrapper should set `supportsNativeStructuredOutput = true` only once Aithy CLI actually validates `--output-schema` and the Smithers wrapper returns that validated value as `GenerateTextResult.output`/`experimental_output`. Until then, leave it false and let Smithers inject JSON instructions.

## 6. Minimal `AithyAgent` Wrapper Sketch

This is an adapter sketch, not an implementation.

```ts
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import {
  BaseCliAgent,
  sanitizeForOpenAI,
  type AgentCliEvent,
  type CliOutputInterpreter,
} from "@smithers-orchestrator/agents";
import { z } from "zod";

export type AithyAgentOptions = {
  id?: string;
  binary?: string;
  cwd?: string;
  provider?: string;
  model?: string;
  apiKeyEnv?: string;
  stateDir?: string;
  botId?: string;
  adapterProfile?: string;
  sandbox?: "disabled" | "microsandbox";
  systemBash?: "enabled" | "disabled";
  env?: Record<string, string>;
  timeoutMs?: number;
};

function isAgentCliEvent(value: unknown): value is AgentCliEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as { type?: unknown; engine?: unknown };
  return (
    typeof event.engine === "string" &&
    (event.type === "started" || event.type === "action" || event.type === "completed")
  );
}

export class AithyAgent extends BaseCliAgent {
  supportsNativeStructuredOutput = false;
  private opts: AithyAgentOptions;

  constructor(opts: AithyAgentOptions = {}) {
    super(opts);
    this.opts = opts;
  }

  createOutputInterpreter(): CliOutputInterpreter {
    return {
      onStdoutLine: (line) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const payload = JSON.parse(trimmed) as unknown;
        if (!isAgentCliEvent(payload)) {
          throw new Error(`Invalid Aithy event line: ${trimmed.slice(0, 200)}`);
        }
        return payload;
      },
    };
  }

  async buildCommand(params: {
    prompt: string;
    systemPrompt?: string;
    cwd: string;
    options: { outputSchema?: z.ZodTypeAny; resumeSession?: string };
  }) {
    const args = ["run", "--prompt-file", "-", "--output-format", "stream-json", "--no-web"];
    args.push("--cwd", params.cwd);
    args.push("--workspace", params.cwd);
    if (this.opts.stateDir) args.push("--state-dir", this.opts.stateDir);
    if (this.opts.botId) args.push("--bot-id", this.opts.botId);
    args.push("--adapter-profile", this.opts.adapterProfile ?? "smithers");
    if (this.opts.provider) args.push("--provider", this.opts.provider);
    if (this.opts.model ?? this.model) args.push("--model", this.opts.model ?? this.model!);
    if (this.opts.apiKeyEnv) args.push("--api-key-env", this.opts.apiKeyEnv);
    args.push("--sandbox", this.opts.sandbox ?? "disabled");
    args.push("--system-bash", this.opts.systemBash ?? "disabled");
    if (params.options.resumeSession) args.push("--session", params.options.resumeSession);

    let schemaFile: string | undefined;
    if (params.options.outputSchema) {
      const jsonSchema = z.toJSONSchema(params.options.outputSchema);
      sanitizeForOpenAI(jsonSchema);
      schemaFile = join(tmpdir(), `smithers-aithy-schema-${randomUUID()}.json`);
      await writeFile(schemaFile, JSON.stringify(jsonSchema), "utf8");
      args.push("--output-schema", schemaFile);
    }

    return {
      command: this.opts.binary ?? "aithy",
      args,
      stdin: params.systemPrompt ? `${params.systemPrompt}\n\n${params.prompt}` : params.prompt,
      outputFormat: "stream-json" as const,
      env: this.opts.env,
      cleanup: async () => {
        if (schemaFile) await rm(schemaFile, { force: true }).catch(() => undefined);
      },
    };
  }
}
```

## 7. First 5 Failing Behavior Tests

Add these before implementation:

1. `capabilities --json` contract:
   `aithy capabilities --json` exits `0`, writes parseable JSON to stdout, writes nothing to stderr, and includes commands, flags, output formats, event types, schema support, sandbox modes, state fields, and the exit-code dictionary.

2. Headless run does not start web UI:
   With a mock model/runtime, `aithy run --prompt "hi" --cwd <tmp> --state-dir <tmp-state> --bot-id t --adapter-profile smithers --sandbox disabled --json` exits `0`, stdout is one valid final JSON object, stderr has no setup/web URL banner, and no Vite/web runtime process is started.

3. Stream-json event contract:
   `aithy run --prompt-file - --output-format stream-json ...` emits only NDJSON stdout with `started`, at least one `action` for a forced mock tool call, and final `completed`. Every line parses independently, and stderr contains only diagnostics.

4. Output schema enforcement:
   With `--output-schema schema.json`, a mock valid structured response exits `0` and final `output` validates. A mock invalid structured response exits `8`, writes deterministic schema diagnostics to stderr, and does not print malformed JSON to stdout.

5. Isolation and resume:
   Two runs with different `--state-dir`/`--bot-id`/`--adapter-profile` cannot see each other's transcript. A run with `--session same-id` can see its prior transcript. A prompt beginning with `/help` is handled as a slash command and is not forwarded to the model.

The next test after these should pin timeout/abort behavior: `--timeout-ms 1` exits `7`; SIGTERM/AbortSignal exits `9`; both keep stdout valid or empty and put the reason on stderr.

## 8. Risks And Decisions Needing Confirmation

- Sandbox default: first implementation is easiest with `--sandbox disabled` and `--workspace=rootDir`, but that means Aithy tools run on the host workspace. Confirm whether Smithers should instead force Microsandbox from day one.
- `system.bash`: Smithers headless runs should default to `disabled`; enabling it would require a non-interactive approval policy or explicit unsupported error.
- Structured output: decide whether Aithy CLI must truly enforce schema before the Smithers wrapper sets `supportsNativeStructuredOutput = true`.
- Adapter profile naming: confirm `--adapter-profile` as the canonical namespace flag and `--profile` as a compatibility alias only. This avoids confusion with Aithy's existing user profile and soul/profile stores.
- Model settings: decide whether Smithers must always pass `--provider`, `--model`, and `--api-key-env`, or whether the wrapper may rely on stored Aithy settings. The design recommends explicit flags for headless runs and no implicit model env var inheritance.
- Session persistence: decide whether default Smithers runs are ephemeral or durable. The design recommends durable only through explicit `--session` or returned `resume`.
- Workspace mapping: confirm that mapping Smithers `rootDir` to Aithy's `/workspace` is acceptable, including generated files under the project root.
- Capabilities registry: decide whether `aithy capabilities --json` should also emit a Smithers `AgentCapabilityRegistry` shape directly, or whether the wrapper should translate.
- Packaging: decide whether the binary is `aithy`, `bun run aithy`, or a package bin. Smithers should invoke a stable executable name.

## Recommendation

Implement this as A: Aithy CLI first, Smithers wrapper second.

Reason: Smithers already has a mature `BaseCliAgent` path for CLI agents, including cwd, env, timeout, abort, stdout/stderr, NDJSON event parsing, and schema plumbing. A headless Aithy CLI gives a stable contract that can be tested independently, avoids coupling Smithers to Aithy's internal TypeScript runtime graph, and avoids introducing a local HTTP server lifecycle just to run one task. The wrapper should be thin once the CLI contract is pinned.

Do not start with an in-process package adapter. It would be faster initially but would couple Smithers to Aithy's private `runMessage` dependencies, SQLite stores, workers, secrets, and sandbox lifecycle before the headless contract is stable.

Do not start with an HTTP/local-server adapter. It adds port allocation, readiness, auth, shutdown, and web setup questions while providing no benefit for Smithers' one-shot task-agent use case.
