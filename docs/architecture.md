# Architecture

Aithy is a local-first TanStack Start app backed by SQLite, Bun workers, and a sandbox provider. The browser UI talks to server functions in the same local app; agent work is processed by runtime services and persisted under the active bot namespace.

## Top-Level Shape

```text
app/                  TanStack Start routes, server functions, SSE, UI
src/agent/            Ax agent construction, message runner, tools
src/commands/         shared slash command parser
src/memory/           durable memory, embedding, reranking, consolidation
src/runtime/          runtime assembly, workers, queue protocol, reset paths
src/sandbox/          Microsandbox, disabled, mock, and unavailable providers
src/session/          logical sessions and SQLite transcript persistence
src/settings/         runtime settings, secrets, localhost guard
src/skills/           bundled skills, search, promotion workflow
```

## Web App

Routes live in `app/routes`. The root route enforces the setup gate before normal app pages load. `/setup` collects the user profile and primary model settings. `/chat` and `/chat/$sessionId` render chat. Supporting pages cover sessions, memory, skills, settings, usage, notifications, themes, and the runtime console.

Server functions live in `app/server`. Mutating server functions call `assertLoopbackRequest` so web mutations stay restricted to loopback requests. Shared request schemas live in `app/server/action-schemas.ts`.

Live browser updates flow through `/api/events`, which exposes a server-sent event stream backed by the runtime live event bus.

## Runtime

`src/runtime/aithy-runtime.server.ts` builds the in-process runtime for the web app. Split runtime services under `src/runtime/services` provide queue, agent, sandbox, and embedding workers. The queue protocol is defined in `src/runtime/protocol`.

The main chat path is:

1. A web server function accepts a chat message.
2. The dispatcher enqueues a user chat job.
3. The agent worker ensures the bot sandbox is available.
4. `runMessage` builds a fresh agent from persisted transcript context, selected skills, memory, profile input, and soul guidance.
5. Tool calls and assistant output are persisted back to the session store and emitted over live events.

## Sessions And Storage

Sessions are logical bot conversations. Multiple conversations share one bot sandbox VM. Session transcripts are durable and stored in SQLite.

SQLite data is grouped by stores:

- session state and messages in `src/session`.
- settings in `src/settings`.
- profile fields and images in `src/profile`.
- soul fields in `src/soul`.
- memories and memory runs in `src/memory`.
- runtime events, commands, grants, and services in `src/runtime`.
- skills and skill promotions in `src/skills`.
- notifications and usage in their matching `src/*` folders.

`schema_migrations` is scoped by subsystem, so separate stores can each start at migration version `1`.

## Settings And Secrets

Base config is loaded by `src/config/env.ts`. Runtime settings saved from the web UI are merged through `src/settings/resolve.ts`.

Provider API keys and Parallel Search API keys use `Bun.secrets` through `src/settings/secrets.ts`. Keys are stored under the active bot namespace, with legacy shared-service fallback for provider keys.

Model provider, model, and API key environment variables are intentionally ignored. Model settings are configured through setup or Settings.

## Sandbox And Host Access

The sandbox provider is selected in `src/sandbox/create-provider.ts`.

- Microsandbox mode runs commands inside a Linux microVM rooted at `/workspace`.
- Disabled mode runs through Bun Shell on the host, still exposing paths through the `/workspace` and `/mounts` abstractions.
- Mock and unavailable providers are used by tests and service fallback paths.

Agent tools are created in `src/agent/tools`. `sandbox.bash` and `sandbox.edit` are normal agent execution tools. Folder mounts are exposed under `/mounts/<basename>-<hash>`, and files are copied into `/workspace`.

`system.bash` is separate host-shell access. It requires a per-command user approval, records a permission message, and audits the decision through the capability broker/runtime store.

## Memory

Memory has two agent-facing flows:

- Auto memory triage, queued after qualifying user turns.
- Explicit memory tools available to the agent.

The memory store uses SQLite FTS and can use sqlite-vec-backed hybrid search when the extension is available. Embedding and reranking are isolated behind service classes so failures can degrade to FTS-only behavior.

Memory consolidation and expiry run through embedded queue workers. Memory runs are tracked separately so users can inspect recent memory processing.

## Skills

Bundled skills are seeded from `config/skills` when the skills store is empty. Skill promotion watches repeated tool-use patterns and drafts suggested reusable skills for user acceptance.

Shared slash command handling is in `src/commands/slash-commands.ts`; supported shared commands are `/help`, `/skills`, and `/session <id | "name">`.
