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

Local state lives at `~/.config/aithy/default/`. Use the web UI and persisted settings for provider-scoped model profiles, search profiles, keys, sandbox settings, and local inference.

Every Aithy is a full Aithy. There is no separate inference-only mode: if you want to share a GPU box with laptops on the same LAN, run Aithy on each machine, open the Mesh page, pair the machines, and mark the relationship level you actually trust.

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

Aithy ships with Parallel Search MCP for public web search. It works through Parallel's free anonymous endpoint by default, so no Parallel account or API key is required. For higher limits or proxying, configure Parallel search in Settings. Search settings are provider-scoped and validated before they are saved, just like model settings.

The larger architecture is ready for much more than one search tool. Ax can expose MCP tools, prompts, and resources as callable functions, then make those functions available through the JavaScript runtime. That means Aithy can scale toward effectively unlimited MCPs without stuffing every tool definition into the model context. The model can discover and call what it needs, when it needs it, while the runtime keeps the tool surface outside the prompt budget.

That is a big deal for serious agent work: more services, more tools, less context pressure, and fewer brittle prompt tricks.

## Aithy Mesh

Aithy Mesh lets full Aithy instances find each other on a local network, pair explicitly, remember that pairing locally, show presence, and share selected services without copying secrets between machines.

The common home-lab shape is simple: run Aithy on a Linux box with the big GPU, run Aithy on your laptop, pair them from the Mesh page, then mark both sides as `family`. Once both sides agree, the laptop can select that family member on the Models page and choose one of the GPU box's currently validated provider slots.

Mesh can be switched off from the Mesh page. Turning it off stops LAN advertising, discovery, pairing, mesh RPC/proxy servers, health checks, and family mesh providers while keeping saved pairings in local SQLite for later.

Mesh is intentionally human-shaped:

- `acquaintance`: paired identity and presence only.
- `friend`: trusted identity and presence, reserved for richer future collaboration.
- `family`: service sharing, only when both sides mark each other as family.

Discovery uses mDNS on the LAN with the `_aithy._tcp` service name. The advertisement is deliberately boring: peer id, display name, mesh API port, certificate fingerprint, HTTP/3 support, and protocol version. It does not advertise provider URLs, API keys, prompts, sessions, memories, service catalogs, or model lists.

Pairing is manual. Opening a pairing window creates a short-lived, single-use code; the code is used to prove both sides saw the same certificate fingerprints and pairing window. The code is not sent as the pairing payload. New pairings start as `acquaintance`, and re-pairing resets trust back to `acquaintance`.

Each Aithy generates a local self-signed mesh TLS certificate on first run. Paired peers pin that certificate, prefer HTTP/3 over QUIC for mesh RPC, and fall back to pinned HTTPS when HTTP/3 is unavailable or blocked. The fallback is still certificate-pinned; mDNS is discovery, not authority.

Family service catalogs are live mesh RPC calls, not discovery payloads. The Models and Search pages fetch catalogs when opened or refreshed, and only paired mutual-family peers can return them. Catalogs are metadata-only: provider label, slot label, model ids, capability kind, search mode, and validation status/time. They are never published through mDNS, returned from healthchecks, cached in peer rows, or stored as client state.

Shared inference is exposed locally as an OpenAI-compatible loopback proxy provider. Provider ids look like `mesh:<peerId>:inference:<serviceId>`, and the local proxy forwards requests to the serving Aithy over pinned TLS. The serving Aithy rebuilds its local catalog on every call and rejects service ids or model ids that are not currently advertised by that validated slot. Mesh providers are never re-shared, which avoids recursive proxying.

Search sharing uses the same model. Search provider ids look like `mesh:<peerId>:search:<serviceId>`, and the serving Aithy resolves the selected live validated search profile before proxying the request. API keys, Grok credentials, Parallel keys, backend URLs, OAuth tokens, local prompts, sessions, memories, and provider configuration stay on the serving machine. Service requests still contain the caller's prompt or search query, because the serving Aithy must process the request.

The UI uses a source selector instead of one giant dropdown. Models can use `This Aithy` or `Family Aithy`; family mode first chooses the family member, then the live provider slot, then an advertised model. Search settings mirror that pattern with local search providers or family member plus family search service. A selected family provider remains visible if it goes offline or stops being offered, but it is disabled until the live catalog is available again.

Mesh v2 is LAN-only. It does not do internet relay, NAT traversal, or multi-network identity sync.

## Built for trust

Aithy is local-first by default. State, sessions, memories, skills, settings, usage, and runtime metadata live under your Aithy config directory unless you deliberately point them elsewhere.

Security is not bolted on at the edge:

- Microsandbox mode runs agent commands in a Linux sandbox.
- Host files are exposed only through explicit attachments or mounts.
- Folder mounts are named and scoped; individual file attachments are copied into the workspace.
- Optional host shell access goes through permission prompts.
- Permission decisions can become scoped capability rules, such as one command, one folder, one host path, or one website origin.
- Slash commands are routed before they reach the agent, so commands like `/help`, `/skills`, and `/session` are not treated as ordinary prompts.
- API keys and provider settings stay local. Non-secret model and search profile settings live in SQLite; credentials live in Bun secrets under Aithy-prefixed names such as `aithy.llm.<provider>.api-key`, `aithy.search.<provider>.api-key`, and `aithy.oauth.<provider>.tokens`.
- Model and search profiles are validated against the current URL, model or mode, and credential version before they are marked valid; changing the profile makes that validation stale until the next successful test.
- Mesh secrets stay local: the mesh TLS private key is stored in Bun secrets, paired certificate pins live in SQLite, and provider API keys are never sent to peers.
- Mesh RPC runs over pinned TLS with HTTP/3 preferred and pinned HTTPS fallback. RPC metadata includes sender, recipient, request id, method, timestamp, nonce, and an ECDSA signature from the caller's pinned mesh certificate; stale, replayed, and unsigned/forged envelopes are rejected.
- Mesh service access requires mutual `family` trust, live catalog authorization, and a current model/service allowlist match. Downgrading or revoking either side removes shared services.
- Usage capture records provider, model, token, cache, and purpose details for visibility.

The agent can be powerful, but it should not be mysterious. Aithy is designed so you can see what is happening, approve risky actions, and keep local state under your control.

## Memory, dreams, skills, and attentions

Aithy has durable conversation memory and a separate memory system for facts worth keeping. Every chat turn performs a deterministic pre-recall before the agent starts, then agent-directed recall uses the same global retrieval pipeline across memories and dream episodes. Retrieval combines full-text and local vector candidates, fuses them, and lets the local reranker make the final ordering decision when it is available; importance and recency only break close ties.

Dreams are episodic memory for work the agent has already done. Aithy can inspect recent sessions, detect practical task episodes, and save what happened: the task, approach, outcome, notes, tools, errors, artifacts, and supporting message evidence. Future runs can reuse those lessons instead of rediscovering the same project gotchas.

Skills are reusable instructions for workflows you repeat. They can be searched, selected, suggested, and tracked by usage. Aithy supports Claude-style skill folders and portable skill bundles: one `SKILL.md` entrypoint with frontmatter, plus optional supporting files like references, examples, and guides. Skill cards, bodies, and attached files are chunked into the local semantic index, so a workflow can be found by what it teaches, not only by its name or tags. Aithy can notice repeated patterns and surface skill candidates, turning habits into reusable agent behavior.

Memory, episode, and skill writes queue targeted local embedding immediately. The periodic backfill still runs as a safety net, and if local inference is down the write still succeeds while retrieval falls back to full-text until indexing catches up. `memory.recall` and `skills.search` tool details include compact diagnostics, and the Local Inference page shows embedded/stale counts plus reranker status.

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
- LAN mesh runtime: mDNS discovery, explicit pairing, peer presence, trust levels, pinned TLS/HTTP3 RPC, and local proxy providers for family Aithys.
- Local SQLite state: sessions, memory, skills, soul guidance, notifications, usage, tasks, automations, permissions, and runtime service status are durable.
- Unified retrieval: SQLite FTS, sqlite-vec, reciprocal-rank fusion, targeted embedding, pre-turn recall, semantic skill chunks, diagnostics, and reranker-primary final ordering.
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
src/mesh/             LAN discovery, pairing, pinned mesh RPC, and shared service proxies
src/runtime/          multi-service runtime, workers, queues, permissions
src/sandbox/          sandbox providers and command execution
src/security/         capability policies and permission gates
src/session/          session state and SQLite persistence
src/settings/         settings, themes, mounts, and API key storage
src/skills/           skill bundles, detection, storage, search, and promotion
src/usage/            provider/model token usage capture
```

The repo enforces a 500-line hard limit with `bun run check:lines`. Keep code clean, simple, and boring: separate subsystems, short files, local patterns first.
