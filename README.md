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

Aithy is a fast, local AI teammate for people who want an agent that feels helpful without feeling out of control.

It runs on your machine, remembers what you approve, works in a sandboxed workspace, tracks what it uses, and gives you a polished web UI with sessions, themes, skills, dreams, attentions, memory, files, and artifacts. The goal is simple: install it, open the browser, talk to your bot, and let it help without needing to become an agent-framework expert first.

## Quick start

You need [Bun](https://bun.sh/) 1.3.14 or newer and a model API key from a supported provider.

```bash
bun install
bun run start
```

Open `http://127.0.0.1:3000`. The welcome screen walks you through your name, optional profile details, choosing a provider, model, and API key.

Local state lives at `~/.config/aithy/default/`. Use the web UI and persisted settings for providers, keys, sandbox settings, search, and local inference.

## Why Aithy feels different

Aithy is built for everyday use first. You do not need to wire a graph, write prompts, or manage a pile of terminal scripts before it becomes useful.

- Easy install, easy setup, and a real web UI.
- Themes and layouts for a chatty personal bot or a quieter work surface.
- Durable sessions, so conversation history becomes useful context instead of disappearing.
- User-approved memory for facts, preferences, and recurring context.
- Dreams that distill recent work into reusable task episodes.
- Skills that capture repeated workflows, including Claude-style folders and portable skill bundles.
- Attentions for reminders, briefings, watches, and ongoing tasks.
- Usage tracking so you can see model and token activity instead of guessing.
- A sandbox workspace for code, files, scripts, and generated artifacts.

Under the hood, Aithy is also designed to be more consistent than the usual "giant prompt plus tools" agent. It uses Ax's RLM-style agent pipeline, with a context distiller, JavaScript runtime executor, and final responder. That structured flow is closer in spirit to DSPy than to prompt soup: the model gets narrower jobs, the runtime handles deterministic work, and smaller models can do more because less of the task is left as one huge reasoning blob.

## Fast, skillful, and model-flexible

Aithy separates the work that should be deterministic from the work that should be linguistic.

The agent can use JavaScript for filtering, parsing, deduping, sorting, and tool orchestration, while the model focuses on understanding, decisions, and response quality. You can also configure a fast model separately from the main model, so cheaper or smaller models can carry parts of the pipeline when that fits your setup.

That is the heart of the consistency story: Aithy is not only asking a model to improvise. It gives the model a runtime, typed functions, stored context, skills, and a permissioned environment to act in.

## MCP without context bloat

Aithy ships with Parallel Search MCP for public web search. It works through Parallel's free anonymous endpoint by default, so no Parallel account or API key is required. For higher limits or proxying, configure Parallel search in Settings.

The larger architecture is ready for much more than one search tool. Ax can expose MCP tools, prompts, and resources as callable functions, then make those functions available through the JavaScript runtime. That means Aithy can scale toward effectively unlimited MCPs without stuffing every tool definition into the model context. The model can discover and call what it needs, when it needs it, while the runtime keeps the tool surface outside the prompt budget.

That is a big deal for serious agent work: more services, more tools, less context pressure, and fewer brittle prompt tricks.

## Built for trust

Aithy is local-first by default. State, sessions, memories, skills, settings, usage, and runtime metadata live under your Aithy config directory unless you deliberately point them elsewhere.

Security is not bolted on at the edge:

- Microsandbox mode runs agent commands in a Linux sandbox.
- Host files are exposed only through explicit attachments or mounts.
- Folder mounts are named and scoped; individual file attachments are copied into the workspace.
- Optional host shell access goes through permission prompts.
- Permission decisions can become scoped capability rules, such as one command, one folder, one host path, or one website origin.
- Slash commands are routed before they reach the agent, so commands like `/help`, `/skills`, and `/session` are not treated as ordinary prompts.
- API keys and provider settings stay local to the runtime configuration.
- Usage capture records provider, model, token, cache, and purpose details for visibility.

The agent can be powerful, but it should not be mysterious. Aithy is designed so you can see what is happening, approve risky actions, and keep local state under your control.

## Memory, dreams, skills, and attentions

Aithy has durable conversation memory and a separate memory system for facts worth keeping. Memory retrieval uses both full-text and vector search, with reranking when available, so the bot can find useful prior context without replaying your whole life into the prompt.

Dreams are episodic memory for work the agent has already done. Aithy can inspect recent sessions, detect practical task episodes, and save what happened: the task, approach, outcome, notes, tools, errors, artifacts, and supporting message evidence. Future runs can reuse those lessons instead of rediscovering the same project gotchas.

Skills are reusable instructions for workflows you repeat. They can be searched, selected, suggested, and tracked by usage. Aithy supports Claude-style skill folders and portable skill bundles: one `SKILL.md` entrypoint with frontmatter, plus optional supporting files like references, examples, and guides. Aithy can notice repeated patterns and surface skill candidates, turning habits into reusable agent behavior.

Attentions are ongoing work: reminders, briefings, watches, and tasks that need to come back later. They make Aithy feel less like a single chat box and more like a small local operating layer for the things you want help tracking.

## Technical architecture

Aithy's technical architecture is way ahead of many open-source agents because it treats the agent as a runtime system, not just a chat loop.

Key pieces:

- Ax RLM pipeline: context distiller, executor, and responder stages with typed signatures.
- JavaScript runtime execution: deterministic work happens in code, not only in model tokens.
- Function-based tools: sandbox, files, web search, web fetch, artifacts, memory, skills, automations, tasks, and permissions are exposed as callable functions.
- MCP-ready shape: MCP tools can become runtime functions instead of prompt-stuffed tool lists.
- Skill bundles: `SKILL.md` plus supporting files can be uploaded, diffed, stored, linked, and loaded on demand.
- Multi-service architecture: web runtime, queue service, agent worker, sandbox worker, and embedding worker are supervised separately.
- Local SQLite state: sessions, memory, skills, soul guidance, notifications, usage, tasks, automations, permissions, and runtime service status are durable.
- Hybrid memory: SQLite FTS, sqlite-vec, reciprocal-rank fusion, importance/recency scoring, and optional cross-encoder reranking.
- Episodic dreams: background extraction turns completed work into searchable agent episodes with evidence and outcomes.
- Capability governance: permission prompts, scoped allow rules, audit paths, and capability policies live in the runtime.
- Sandboxed execution: Microsandbox gives the agent a persistent workspace without handing it the whole host by default.
- Usage accounting: model usage is captured per provider, model, purpose, session, and run.
- Clean subsystem boundaries: startup wiring stays in `src/main.ts`; behavior lives in focused subsystem files.

This is the difference between "an LLM with tools" and an agent platform that can keep growing without becoming fragile.

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
src/agent/            Ax agent setup, message runner, tools
src/automations/      attentions, schedules, and background actions
src/commands/         shared slash commands
src/episodes/         dreams, episodic memory, and episode retrieval
src/memory/           memory storage, retrieval, embedding, and consolidation
src/runtime/          multi-service runtime, workers, queues, permissions
src/sandbox/          sandbox providers and command execution
src/security/         capability policies and permission gates
src/session/          session state and SQLite persistence
src/settings/         settings, themes, mounts, and API key storage
src/skills/           skill bundles, detection, storage, search, and promotion
src/usage/            provider/model token usage capture
```

The repo enforces a 500-line hard limit with `bun run check:lines`. Keep code clean, simple, and boring: separate subsystems, short files, local patterns first.
