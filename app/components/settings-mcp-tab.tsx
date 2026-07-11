import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Section, fieldClass, selectClass } from "@/components/settings-form-bits";
import {
  configureAithyMcpServer,
  regenerateAithyMcpServerToken,
  removeMcpServer,
  saveMcpServer,
  testMcpServer,
} from "@/server/actions.functions";
import type { McpSettingsStatusDto } from "@/server/dto";
import type { McpServerProfile } from "../../src/settings/types";

type Draft = McpServerProfile & { id: string; token: string; clearToken: boolean };
const emptyDraft = (): Draft => ({ id: "", label: "", url: "https://", transport: "streamable-http", authMode: "none",
  headerName: null, enabled: true, exposePrompts: false, exposeResources: false, allowLoopback: false, allowHttp: false,
  token: "", clearToken: false });

export function McpSettingsTab({ initial }: { initial: McpSettingsStatusDto }) {
  const [clients, setClients] = useState(initial.clients);
  const [server, setServer] = useState(initial.server);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [port, setPort] = useState(initial.server.port);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);

  async function saveDraft(testOnly = false) {
    if (!draft) return;
    setBusy(true); setMessage(null);
    try {
      const data = { ...draft, token: draft.token || undefined };
      if (testOnly) {
        const result = await testMcpServer({ data });
        setMessage(`Connected. ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"} available.`);
      } else {
        const result = await saveMcpServer({ data });
        setClients((current) => ({ ...current, [draft.id]: result.server }));
        setDraft(null); setMessage("MCP server saved.");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "MCP request failed."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setMessage(null);
    try {
      await removeMcpServer({ data: { id } });
      setClients((current) => { const next = { ...current }; delete next[id]; return next; });
      setMessage("MCP server removed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove MCP server."); }
    finally { setBusy(false); }
  }

  async function configureServer(enabled: boolean) {
    setBusy(true); setMessage(null); setRevealedToken(null);
    try {
      const result = await configureAithyMcpServer({ data: { enabled, port } });
      setServer(result.status); setRevealedToken(result.token);
      setMessage(enabled ? "Aithy MCP server enabled." : "Aithy MCP server disabled.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not configure Aithy MCP server."); }
    finally { setBusy(false); }
  }

  async function regenerate() {
    setBusy(true); setMessage(null);
    try {
      const result = await regenerateAithyMcpServerToken();
      setServer(result.status); setRevealedToken(result.token); setMessage("Bearer token replaced.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not regenerate token."); }
    finally { setBusy(false); }
  }

  return <div className="grid gap-5">
    {message ? <p className="rounded-xl border border-[rgb(var(--border))] px-3 py-2 text-sm">{message}</p> : null}
    <Section title="MCP clients" subtitle="Connect remote tool servers. Remote descriptions and results are untrusted data; every tool call remains permission-gated.">
      <div className="grid gap-3">
        {Object.entries(clients).map(([id, item]) => <div key={id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border))] p-3">
          <div><p className="font-medium">{item.profile.label}</p><p className="text-xs text-[rgb(var(--muted-foreground))]">{id} · {item.profile.url} · token {item.tokenConfigured ? "stored" : "not stored"}</p></div>
          <div className="flex gap-2"><Button variant="soft" onClick={() => setDraft({ id, ...item.profile, token: "", clearToken: false })}>Edit</Button><Button variant="soft" disabled={busy} onClick={() => void remove(id)}>Remove</Button></div>
        </div>)}
        <Button variant="soft" onClick={() => setDraft(emptyDraft())}>Add MCP server</Button>
      </div>
      {draft ? <McpDraftForm draft={draft} setDraft={setDraft} busy={busy} onTest={() => void saveDraft(true)} onSave={() => void saveDraft(false)} onCancel={() => setDraft(null)} /> : null}
    </Section>
    <Section title="Aithy's read-only MCP server" subtitle="Loopback-only and bearer-authenticated. Exposes memory search, skill reads, and artifact metadata/previews outside agent permission governance.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Port"><input className={fieldClass} type="number" min={1024} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} /></Field>
        <div className="self-end text-sm text-[rgb(var(--muted-foreground))]">{server.running ? `Running at http://127.0.0.1:${server.port}/mcp` : server.configured ? "Configured but stopped" : "Not configured"}</div>
      </div>
      {revealedToken ? <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3"><p className="text-sm font-medium">Copy this token now. It will not be shown again.</p><code className="mt-2 block break-all text-xs">{revealedToken}</code></div> : null}
      <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void configureServer(!server.running)}>{server.running ? "Disable server" : "Enable server"}</Button><Button variant="soft" disabled={busy || !server.configured} onClick={() => void regenerate()}>Regenerate token</Button></div>
    </Section>
  </div>;
}

function McpDraftForm({ draft, setDraft, busy, onTest, onSave, onCancel }: { draft: Draft; setDraft: (draft: Draft) => void; busy: boolean; onTest(): void; onSave(): void; onCancel(): void }) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const warning = draft.url.startsWith("http:") ? "Unencrypted HTTP can expose credentials and tool data." : /localhost|127\.0\.0\.1|\[::1\]/.test(draft.url) ? "Loopback access can reach services on this host." : null;
  return <div className="mt-4 grid gap-4 rounded-xl border border-[rgb(var(--border))] p-4">
    <div className="grid gap-4 sm:grid-cols-2"><Field label="ID"><input className={fieldClass} value={draft.id} onChange={(e) => set("id", e.target.value.toLowerCase())} placeholder="github" /></Field><Field label="Label"><input className={fieldClass} value={draft.label} onChange={(e) => set("label", e.target.value)} /></Field></div>
    <Field label="URL"><input className={fieldClass} value={draft.url} onChange={(e) => set("url", e.target.value)} /></Field>
    {warning ? <p className="text-sm text-amber-600">{warning}</p> : null}
    <div className="grid gap-4 sm:grid-cols-2"><Field label="Transport"><select className={selectClass} value={draft.transport} onChange={(e) => set("transport", e.target.value as Draft["transport"])}><option value="streamable-http">Streamable HTTP</option><option value="sse">Legacy HTTP + SSE</option></select></Field><Field label="Authentication"><select className={selectClass} value={draft.authMode} onChange={(e) => { const authMode = e.target.value as Draft["authMode"]; setDraft({ ...draft, authMode, ...(authMode === "none" ? { token: "", clearToken: true } : {}) }); }}><option value="none">None</option><option value="bearer">Bearer token</option><option value="header">Custom header</option></select></Field></div>
    {draft.authMode === "header" ? <Field label="Header name"><input className={fieldClass} value={draft.headerName ?? ""} onChange={(e) => set("headerName", e.target.value)} /></Field> : null}
    {draft.authMode !== "none" ? <><Field label="Token"><input className={fieldClass} type="password" value={draft.token} disabled={draft.clearToken} onChange={(e) => setDraft({ ...draft, token: e.target.value, clearToken: false })} placeholder="Leave blank to keep stored token" /></Field><label className="text-sm"><input type="checkbox" checked={draft.clearToken} onChange={(e) => setDraft({ ...draft, clearToken: e.target.checked, ...(e.target.checked ? { token: "" } : {}) })} /> Remove the stored token</label></> : null}
    <div className="grid gap-2 text-sm"><label><input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} /> Enabled</label><label><input type="checkbox" checked={draft.allowHttp ?? false} onChange={(e) => set("allowHttp", e.target.checked)} /> Allow unencrypted HTTP</label><label><input type="checkbox" checked={draft.allowLoopback ?? false} onChange={(e) => set("allowLoopback", e.target.checked)} /> Allow loopback targets</label><label><input type="checkbox" checked={draft.exposePrompts ?? false} onChange={(e) => set("exposePrompts", e.target.checked)} /> Expose remote prompts</label><label><input type="checkbox" checked={draft.exposeResources ?? false} onChange={(e) => set("exposeResources", e.target.checked)} /> Expose remote resources</label></div>
    <div className="flex flex-wrap gap-2"><Button variant="soft" disabled={busy} onClick={onTest}>Test</Button><Button disabled={busy} onClick={onSave}>Save</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
  </div>;
}
