# Aithy

```text
      ..:::::..
   .:+#########+:.
  :###=:....:=###:
 .##+  AITHY   +##.
 :##  local AI  ##:
 .##+  //////  +##.
  :###=::::=###:
   .:+#####:+.
      ':::'
```

Aithy is a local AI agent that runs on your machine. It can help with projects, remember useful context over time, run code in a sandboxed workspace, and keep your history and secrets under your control.

## Quick start

You need [Bun](https://bun.sh/) 1.3.14 or newer and a model API key from a supported provider.

```bash
bun install
bun run start
```

Open `http://127.0.0.1:3000`. The welcome screen walks you through your name, optional profile details, choosing a provider, model, and API key.

Local state lives at `~/.config/aithy/default/`. Set `AITHY_BOT_ID` or `AITHY_STATE_DIR` if you want a different namespace or multiple bots.

Aithy uses Parallel Search MCP for public web search. Search works through Parallel's free anonymous endpoint by default, so no Parallel account or API key is required. For higher limits, set `AITHY_PARALLEL_API_KEY` or `PARALLEL_API_KEY`; for testing or proxying, set `AITHY_PARALLEL_SEARCH_MCP_URL`.

## What it does

- Runs as a personal agent on your own setup.
- Keeps durable conversation history and user-approved memory.
- Searches the public web through free Parallel Search MCP, then reads known URLs with its local web fetcher.
- Uses a persistent sandbox workspace for commands, scripts, and generated files.
- Lets you attach or mount files when you want the agent to work with local project data.
- Surfaces reusable skills when it notices repeated workflows.
- Stores state, secrets, and history locally.

## Sandbox and files

Aithy uses a bot-scoped workspace at `~/.config/aithy/<botId>/workspace/`. Files there survive across conversations and app restarts.

When Microsandbox is enabled, agent commands run in a Linux sandbox. Host files are available only when you explicitly attach or mount them. Folder mounts appear in the sandbox under `/mounts/<name>`, and individual file attachments are copied into the workspace.

You can manage sandbox settings and mounts from **Settings -> Sandbox**.

## Commands

Shared slash commands are handled before a message reaches the agent:

- `/help` lists commands.
- `/skills` opens the skills selector.
- `/session` shows the current session.
- `/session <id | "name">` switches by id or quoted name, creating the session if needed.

## Development

```bash
bun run check               # line budget + typecheck + tests
bun test                    # full test suite
bun run check:lines         # 500-line file limit
bun run debug               # list SQLite tables
bun run debug <table> <id>  # inspect a table
bun run memory <session-id> # reprocess a session
```

Useful project areas:

```text
app/                  TanStack Start routes, server functions, SSE, UI
src/agent/            agent setup, message runner, tools
src/commands/         shared slash commands
src/memory/           memory storage and background processing
src/sandbox/          sandbox providers
src/session/          session state and SQLite persistence
src/settings/         settings and API key storage
src/skills/           skill detection and promotion
src/runtime/          server-side runtime construction
```

The repo enforces a 500-line hard limit with `bun run check:lines`. Keep subsystems split into focused files, and put startup wiring in `src/main.ts`.
