# Operations

This guide covers local state, reset behavior, host-shell approvals, and safe debugging for Aithy.

## Local State

Aithy stores bot-scoped state under `~/.config/aithy/<botId>/` by default. `AITHY_BOT_ID` defaults to `default`, so the default state root is `~/.config/aithy/default/`.

Key paths:

- `state.db`: SQLite state for sessions, settings, profile, soul, skills, memories, notifications, usage, and runtime data.
- `workspace/`: shared bot workspace. Files here survive app restarts and sandbox restarts.
- `traces/`: chat trace files when trace mode is enabled.
- `cache/`: runtime/model cache data used by embedding and related services.

Useful environment overrides:

- `AITHY_BOT_ID`: namespace for state and the Microsandbox VM name.
- `AITHY_STATE_DIR`: base state directory.
- `AITHY_WORKSPACE_ROOT`: host directory backing `/workspace`.

## Setup And Model Settings

The web setup gate requires a user profile name, model, and provider credentials unless the provider does not require an API key. Provider API keys and Parallel Search API keys are stored through `Bun.secrets` in the bot namespace.

The model and provider are saved through Settings. `AITHY_AI_PROVIDER`, `AITHY_AI_MODEL`, and `AITHY_AI_API_KEY` are intentionally ignored by `loadConfig`; use the setup screen or Settings instead.

## Sandbox Modes

`AITHY_SANDBOX_PROVIDER=microsandbox` is the default. Agent shell commands run in a Linux microVM rooted at `/workspace`.

`AITHY_SANDBOX_PROVIDER=disabled` runs `sandbox.bash` locally on the host through Bun Shell. Use this only when local execution without VM isolation is acceptable.

Microsandbox settings:

- `AITHY_SANDBOX_IMAGE`: default `python:3.11-slim`.
- `AITHY_SANDBOX_CPUS`: default `1`.
- `AITHY_SANDBOX_MEMORY_MB`: default `512`.
- `AITHY_SANDBOX_NETWORK`: `none`, `public`, or `allow-all`; default `none`.

## Mounts And Files

The bot workspace is available inside the sandbox as `/workspace`. Folder mounts are read-write bind mounts under `/mounts/<basename>-<hash>`. Single file attachments are copied into `/workspace/<filename>` or a hashed variant when names collide.

Global mounts are managed in Settings -> Sandbox and apply to every sandbox for the bot. Missing host paths are saved but skipped at sandbox start.

## Host Shell Approvals

When `AITHY_SYSTEM_BASH_ENABLED` is true, the agent can request `system.bash` for host-only commands. Each command requires a user approval in chat before execution.

`system.bash` is for host state that the sandbox cannot access, such as absolute host paths that are not mounted, host-installed tools, OS services, SSH/keychain access, daemons, or hardware. Normal repository work should use `sandbox.bash`.

Disable host-shell requests with:

```bash
AITHY_SYSTEM_BASH_ENABLED=false
```

## Reset And Destructive Operations

The Settings danger zone exposes destructive actions guarded by the confirmation text `Yes, I'm sure`.

- Delete all sessions: deletes every conversation, sub-session, and related task record, and stops active work.
- Reset memories: removes stored memories, memory index rows, and memory task runs.
- Reset system: stops active work, recreates SQLite databases, clears app-managed provider secrets, resets SQLite-backed app data, removes the bot Microsandbox VM, and clears runtime cache.

The CLI reset script removes bot state without opening the web UI:

```bash
bun run fresh-start [<bot id>]
bun run fresh-start --all
```

`--all` removes the whole Aithy state root after removing known Microsandbox VMs for each bot namespace. Do not run it unless every local bot namespace can be discarded.

## Debugging State

List SQLite tables:

```bash
bun run debug
```

Inspect a table:

```bash
bun run debug <table>
```

Look up a row by the table's primary lookup column:

```bash
bun run debug <table> <id>
```

Reprocess memory over a stored session transcript:

```bash
bun run memory <session-id>
bun run memory <session-id> --hybrid
```

`bun run memory` uses the configured provider and stored credentials. It writes to the real bot database.

## Verification

Before opening a change:

```bash
bun run check
```

This runs supply-chain policy, line budget, typecheck, and the Bun test suite. `bun install` installs the repo-pinned Bun from `package.json`; use `bun run check` and `bun run test` so scripts resolve that local runtime.
