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

Aithy is your own AI agent. It lives on your machine, remembers what matters, runs code in its own little sandboxed world, and gets things done for you even when you're not around.

Think of it as a personal companion with a real runtime. You give it a goal, it thinks it through, writes code, runs commands, looks things up, and comes back with the result. Over time it learns the shape of your work and your preferences, and that memory stays yours, on your hardware.

Built on Bun, with DSPy-style typed reasoning via Ax, an RLM-style runtime for the agent's own code, SQLite for durable memory, and microVMs for safe execution.

## Quick start

You need [Bun](https://bun.sh/) and a model API key (OpenAI, Anthropic, Google, etc.).

```bash
bun install
bun run start
```

Open `http://127.0.0.1:3000` — the welcome screen walks you through picking a provider, model, and API key. That's it.

Local state lives at `~/.config/aithy/default/` (SQLite database, traces, and the bot's shared `/workspace` directory). Override with `AITHY_BOT_ID` or `AITHY_STATE_DIR` if you want a different namespace, or run multiple bots side by side.

## What it does for you

- A personal agent that runs on your own setup, no cloud account required.
- Real working memory that grows over time and that you can actually inspect.
- A shared Linux sandbox the bot reuses across all of its conversations — it can install things, run scripts, and build artifacts without touching your host.
- Skills it learns from how you actually use it, surfaced when it spots a repeating pattern.
- Yours: state, secrets, and history live in your home directory and nowhere else.

## Tech stack

- **Bun** — runtime, bundler, SQLite driver, and secrets store.
- **Ax (`@ax-llm/ax`)** — DSPy-style typed signatures and agents in TypeScript.
- **RLM-style runtime (`AxJSRuntime`)** — the agent reasons by writing JavaScript that calls typed tools.
- **SQLite + FTS5 (always) + `sqlite-vec` when available** — lexical retrieval is the baseline. Vector search and a cross-encoder reranker layer on top when the runtime can load `sqlite-vec`; otherwise the bot runs in FTS5-only mode. Embeddings use `Xenova/all-MiniLM-L6-v2`; reranking uses `Xenova/ms-marco-MiniLM-L-6-v2`.
- **`@xenova/transformers` on `onnxruntime-node`** — embeddings and reranker run in-process, no external service.
- **Microsandbox** — one Linux microVM per bot for code execution, shared across all of that bot's conversations.
- **TanStack Start** — web UI and SSE event stream.

## Sandbox and safety model

Each bot has one Linux microVM through Microsandbox, started from an OCI image and shared across every conversation that bot has. The VM parks when nothing is running and resumes on the next message.

The sandbox filesystem is bot-scoped:

- `/workspace` is the bot's persistent workspace, bind-mounted from `~/.config/aithy/<botId>/workspace/` on the host. Files survive across conversations and across VM restarts.
- `/mounts/<name>` are user-selected host folders, bind-mounted at top level (read-write). Manage them in **Settings → Sandbox**.

With Microsandbox enabled, the agent's only paths into the outside world are explicit:

- `sandbox.bash({ command, cwd?, timeoutMs? })` executes inside the VM.
- `sandbox.edit({ path, search, replace })` performs surgical edits.
- `sandbox.mount({ hostPath })` exposes selected host paths — folders bind-mount at `/mounts/<name>`, individual files copy-on-write into `/workspace/<filename>`.

The agent never gets host shell access. Host files are exposed only through explicit mounts.

## Memory system

```text
                 +--------------------+
   user message ->| Memory Triage Agent |-- memory.write/supersede/delete
                 +---------+----------+
                           |
                           v
                +---------------------+
                |  SQLite memories    |<---- nightly Consolidator Agent
                |  + memories_fts     |      (dedupe, merge, supersede)
                |  + memories_vec     |
                +---------+-----------+
                          |
        +-----------------+-----------------+
        v                                   v
 +---------------+                  +-----------------+
 | FTS5 (bm25)   |                  | vec0 KNN        |
 | top 30        |                  | MiniLM 384d     |
 +------+--------+                  | top 30          |
        |                           +--------+--------+
        +------------> RRF k=60 <------------+
                          |
                          v
            +--------------------------+
            | Cross-encoder reranker   |
            | scores top 30 candidates |
            | against each query       |
            +-----------+--------------+
                        |
                        v
                top-N entries to agent
```

Each retrieval layer degrades independently. Vector failures fall back to FTS-only for that query. Reranker failures fall back to RRF plus importance and recency. `search()` keeps the same hook contract for the agent regardless of retrieval mode.

Session transcripts are durable conversation memory. They are stored in `session_items` and used to rebuild the agent context each turn. The Microsandbox VM is a process resource and is recreated after restart; the bot's `/workspace` files persist on disk between runs.

## Configuration

Almost everything is editable from the **Settings** page. The env vars below are headless overrides for scripted setups; you do not need them for normal use.

```bash
AITHY_BOT_ID=default                # namespaces state directory; run multiple bots side by side
AITHY_STATE_DIR=~/.config/aithy     # state root
AITHY_AI_PROVIDER=openai            # primary model provider
AITHY_AI_APIKEY=...                 # otherwise stored via Bun.secrets when set in the UI
AITHY_AI_MODEL=gpt-4.1
AITHY_SANDBOX_PROVIDER=microsandbox # microsandbox | disabled
AITHY_SANDBOX_IMAGE=python:3.11-slim
AITHY_SANDBOX_NETWORK=none          # none | public | allow-all
AITHY_PARALLEL_AGENTS=1             # worker pool for the user-chat queue
```

API keys entered through the Settings page are stored with `Bun.secrets` under the `com.aithy.local` service. SQLite stores only non-secret settings and a flag indicating whether a key is configured.

The default bot soul is seeded from `config/config.json` when no stored profile exists. Editable soul fields are persisted in SQLite `metadata` rows using `bot.*` keys such as `bot.name`, `bot.description`, and `bot.coreNature`.

## Development checks

```bash
bun run check                                # line budget + typecheck + tests
bun test                                     # full suite
bun run check:lines                         # 500-line file limit
bun run scripts/memory-smoke.ts --hybrid     # hybrid retrieval smoke test
bun run scripts/embed-backfill.ts            # re-embed memories after a model change
```

Debug SQLite state:

```bash
bun run debug
bun run debug <table>
bun run debug <table> <id>
```

Shared slash commands are routed before prompts reach the agent:

- `/help` lists commands.
- `/skills` opens the web skills selector.
- `/session` shows the current session.
- `/session <id | "name">` switches by id or quoted name, creating the session if needed.

## Architecture map

```text
app/                  TanStack Start routes, server functions, SSE, UI
src/agent/            Ax signatures, AxAgent setup, message runner, tools
src/memory/           Memory store, hybrid retriever, triage + consolidator agents
src/sandbox/          Microsandbox, disabled, and test providers
src/session/          Per-conversation state, SQLite persistence, TTL cleanup
src/settings/         Web settings + Bun.secrets wrapper for API keys
src/soul/             Soul profile storage and responder guidance rendering
src/skills/           Skill promotion and repeated-pattern detection
src/notifications/    In-app notification store + live event hub
src/runtime/          Server-side runtime construction
```

Startup wiring belongs in `src/main.ts`; behavior belongs in subsystem files. The repo enforces a 500-line hard limit with `scripts/check-lines.ts`.

## Roadmap

- **Memory eval harness.** A small CLI for Recall@5 / nDCG over labeled queries, so retrieval changes are gated by data instead of vibes.
- **Skill promotion v2.** The daily `SkillPromoteQueue` detects repeated tool-call patterns and surfaces "save this as a skill?" notifications. Next step: round-trip through a sub-session so the user can accept inline.
- **`node:sqlite` migration when Bun ships it.** This would remove the macOS Homebrew SQLite prerequisite for `loadExtension`. Tracked in [oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290).
