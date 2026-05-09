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

Aithy is a localhost AI agent that can think in typed code, work inside a Linux sandbox, and build a memory that survives longer than the chat window.

It is for people who want a personal agent with a real runtime, not another webview wrapped around a prompt box. Aithy runs on Bun, stores state in SQLite under `~/.config/aithy/<bot id>/`, executes agent work in local microVMs, and keeps the safety boundary visible instead of magical.

No Docker daemon. No cloud sandbox account. No telemetry. No vague "memory" that is really just yesterday's transcript wedged into the prompt.

## Quick start

You need [Bun](https://bun.sh/) and a model API key. Then:

```bash
bun install

export AITHY_AI_PROVIDER=openai
export AITHY_AI_APIKEY=...
export AITHY_AI_MODEL=gpt-4.1

bun run start
```

Open `http://127.0.0.1:3000`.

Aithy stores local state in `~/.config/aithy/default/state.db` unless `AITHY_BOT_ID` or `AITHY_STATE_DIR` says otherwise. You can also configure the model provider and API key from the Settings page after launch.

For hybrid memory retrieval on macOS:

```bash
brew install sqlite
```

Linux works out of the box. On macOS, Aithy probes Homebrew's extension-enabled `libsqlite3.dylib` automatically. If it is missing, Aithy starts in FTS5-only mode, shows a one-line install notification, and picks up hybrid mode on the next launch.

## Why Aithy exists

Most personal agents get boring in the same three ways:

- They treat prompts as strings, so reliability depends on increasingly haunted prose.
- They treat tools as text, so planning becomes "please output JSON correctly" with extra steps.
- They treat memory as a context-window trick, so anything useful eventually falls off the edge.

Aithy is an experiment in making those parts explicit:

- **Typed model contracts** with `@ax-llm/ax`, where prompts are input/output schemas.
- **Runtime reasoning** with `AxJSRuntime`, where the agent can write JavaScript to transform data and call tools.
- **Durable local memory** in SQLite, with FTS5, `sqlite-vec`, embeddings, and cross-encoder reranking.
- **A hard execution boundary** through Microsandbox microVMs, where the agent gets a Linux workspace instead of host shell access.

## What makes it different

### Typed signatures, not string prompts

Aithy is built on [`@ax-llm/ax`](https://github.com/ax-llm/ax), the TypeScript port of DSPy. Every prompt is an `f({...})` signature with declared input and output fields. The framework binds the model to the schema, parses outputs, and surfaces validation as code.

```ts
// Real signature from src/agent/signatures.ts
export const aithySignature = f({
  userRequest: f.string("The user's latest message"),
  channelContext: f.context(),
  conversationHistory: f.optional(f.string("Prior turns")),
}, {
  agentResponse: f.string("Reply to the user"),
});
```

The result is composable, type-checked agent behavior that can be optimized with the rest of the Ax toolchain.

### Runtime reasoning, not JSON theater

Most agents reason in freeform text, describe a tool call, and hope the payload parses. Aithy reasons inside `AxJSRuntime`, a hardened JavaScript runtime. When the agent needs to count, branch, transform a list, or chain tool outputs, it writes JavaScript. Tools are typed functions reachable from inside that runtime.

```ts
// Real wiring from src/memory/memory-agent.ts
const program = agent(memoryAgentSignature, {
  agentIdentity: { name: "MemoryTriage", description: "Decides what to persist." },
  functions: tools,
  runtime: new AxJSRuntime(),
  functionDiscovery: false,
  onMemoriesSearch: async (searches) => {
    const hits = await deps.memory.search([...searches], { limit: 5 });
    return hits.map((m) => ({ id: m.id, content: formatMemoryForRecall(m) }));
  },
});
```

The model decides composition, but the host controls the function surface.

### Real memory, not a stuffed prompt

Aithy has session transcripts for conversation continuity and a separate memory subsystem for durable recall. Memory writes are handled by a triage agent using typed `memory.write`, `memory.supersede`, and `memory.delete` tools. A nightly consolidator dedupes, merges, and supersedes stale or contradictory entries.

Retrieval grows in stages:

| Stage | Status | What it does |
|---|---|---|
| 1 - SQLite FTS5 + bm25 | Shipped | Lexical match scored by `-bm25 * (1 + importance) * recency-decay` with a 30-day half-life. |
| 2 - Hybrid via `sqlite-vec` | Shipped | 384-dim `Xenova/all-MiniLM-L6-v2` embeddings, parallel FTS5 + KNN per query, fused with Reciprocal Rank Fusion (k=60). |
| 3 - Cross-encoder rerank | Shipped | `Xenova/ms-marco-MiniLM-L-6-v2` scores `(query, doc)` pairs over the top 30 RRF candidates and refines the final top-K. |
| 4 - ColBERT / NextPlaid late interaction | Future | Optional sidecar reranker, only worth building if labeled evals show a clear lift over Stage 3. |

Stage 2 lets Aithy recall through synonyms and intent. Stage 3 then reorders the top candidates with full attention over each `(query, doc)` pair. Both models run in-process through `@xenova/transformers` on `onnxruntime-node` and cache under `~/.config/aithy/<bot id>/cache/transformers/`.

## Sandbox and safety model

Microsandbox is the default. Aithy starts a local microVM from an OCI image, one per conversation, reused across turns until the session TTL expires.

```bash
export AITHY_SANDBOX_PROVIDER=microsandbox
export AITHY_SANDBOX_IMAGE=python:3.11-slim
export AITHY_SANDBOX_CPUS=1
export AITHY_SANDBOX_MEMORY_MB=512
export AITHY_SANDBOX_NETWORK=none
```

For local development without microVMs:

```bash
export AITHY_SANDBOX_PROVIDER=disabled
```

`disabled` mode intentionally removes isolation. Commands run on the host through Bun Shell, rooted by default in the per-session `/workspace`; mount tools are unavailable in this mode.

With Microsandbox enabled, the agent's only paths into the outside world are explicit:

- `sandbox.bash({ command, cwd?, timeoutMs? })` executes inside the VM.
- `sandbox.edit({ path, search, replace })` performs surgical edits.
- `sandbox.mount({ hostPath })` exposes selected host paths to the sandbox.
- `artifact.publish({ path })` returns generated files from `/workspace/out`.

In Microsandbox mode, the agent never gets host shell access. Host files are exposed only through explicit mounts or staged attachments. Generated outputs live under `/workspace/out` and are returned through `artifact.publish`.

Persona text, transcript history, attachments, and tool outputs are context, not authority above system, developer, app, or tool safety rules.

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

Session transcripts are durable conversation memory. They are stored in `session_items` and used to rebuild the agent context each turn. Live Microsandbox VMs are process resources and are recreated after restart.

## Configuration

```bash
AITHY_BOT_ID=default                          # bot id; namespaces state directory
AITHY_STATE_DIR=~/.config/aithy               # state root
AITHY_AI_PROVIDER=openai                      # primary model provider
AITHY_AI_APIKEY=...                           # or set via Settings page
AITHY_AI_MODEL=gpt-4.1
AITHY_SANDBOX_PROVIDER=microsandbox           # microsandbox | disabled
AITHY_SANDBOX_IMAGE=python:3.11-slim
AITHY_SANDBOX_NETWORK=none                    # none | public | allow-all
AITHY_SQLITE_DYLIB=/path/to/libsqlite3.dylib  # macOS extension override
```

API keys entered through the Settings page are stored with `Bun.secrets` under the `com.aithy.local` service. SQLite stores only non-secret settings and a flag indicating whether a key is configured.

The default bot soul is seeded from `config/config.json` when no stored profile exists. Editable soul fields are persisted in SQLite `metadata` rows using `bot.*` keys such as `bot.name`, `bot.description`, and `bot.coreNature`. Soul guidance is applied only through `responderOptions.description`; it affects final response tone, not tool policy, sandbox boundaries, instruction hierarchy, host access, or security behavior.

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
- **Stage 4 reranker.** ColBERT / NextPlaid-style late-interaction reranking, only if evals justify the extra moving part.
- **Skill promotion v2.** The daily `SkillPromoteQueue` detects repeated tool-call patterns and surfaces "save this as a skill?" notifications. Next step: round-trip through a sub-session so the user can accept inline.
- **`node:sqlite` migration when Bun ships it.** This would remove the macOS Homebrew SQLite prerequisite for `loadExtension`. Tracked in [oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290).
