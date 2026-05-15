# ACP Stdio Adapter

Aithy can run as a minimal Agent Client Protocol agent over stdin/stdout:

```bash
bun run acp
```

The adapter is an additional entrypoint over Aithy's existing runtime. It uses
the same bot-scoped SQLite state, sessions, memory, skills, sandbox settings,
model settings, and worker-backed chat path as the web UI.

Implemented ACP methods:

- `initialize`
- `authenticate`
- `newSession`
- `prompt`
- `cancel`

`newSession` creates an ACP session id and maps it to an Aithy conversation id
with an `acp-` prefix. `prompt` accepts text prompt blocks, stores the user turn
in Aithy's session transcript, enqueues the existing Aithy user-chat path, and
emits the final assistant text as an ACP `agent_message_chunk`.

MVP limitations:

- Assistant output is final-text-only. Intermediate text and tool updates are
  not streamed to ACP yet.
- Attachments, images, external-client model settings, session list/load, and
  Poolside Studio integration are not implemented.
- ACP workspace metadata is accepted for session setup bookkeeping, but Aithy's
  own sandbox and workspace configuration remain authoritative.
- `system.bash` is disabled for ACP prompt jobs. It should remain disabled until
  Aithy can route host-shell approvals through ACP permission requests.
- Cancellation is best effort. It stops queued or active Aithy work where the
  existing runtime can do so and suppresses further ACP updates, but an in-flight
  model or tool call may not stop immediately.
