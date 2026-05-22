import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Activity, ChevronDown, Circle, Clipboard, Cpu, Link2, ListTree, Power, RadioTower, RotateCw, Shield, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { Field, fieldClass, selectClass } from "@/components/settings-form-bits";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  openMeshPairingWindow,
  pairMeshPeer,
  regenerateMeshIdentity,
  revokeMeshPeer,
  saveMeshEnabled,
  saveMeshSharing,
  setMeshPeerTrust,
  unpairMeshPeer,
} from "@/server/actions.functions";
import type { MeshPageStateDto, MeshStateDto } from "@/server/dto";
import type { MeshTrustLevel } from "../../src/mesh/types";

export function MeshPage({ initialState }: { initialState: MeshPageStateDto }) {
  const [state, setState] = useState(initialState);
  const [pairCodes, setPairCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<MeshPageStateDto>) {
    setBusy(label);
    setError(null);
    try {
      setState(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mesh action failed");
    } finally {
      setBusy(null);
    }
  }

  const mesh = state.mesh;
  const stats = useMemo(() => meshStats(mesh), [mesh]);

  return (
    <PageFrame eyebrow="LOCAL NETWORK" title="Mesh" subtitle="trusted agents on your LAN">
      {error ? <p className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p> : null}
      <div className="grid gap-5">
        <MeshMonitor mesh={mesh} stats={stats} busy={busy} run={run} />
        <div className="grid gap-5 xl:grid-cols-2">
          <PairedPeers mesh={mesh} busy={busy} run={run} />
          <DiscoveredPeers mesh={mesh} pairCodes={pairCodes} setPairCodes={setPairCodes} busy={busy} run={run} />
        </div>
        <MeshSettings mesh={mesh} busy={busy} run={run} />
      </div>
    </PageFrame>
  );
}

function MeshMonitor({
  mesh,
  stats,
  busy,
  run,
}: {
  mesh: MeshStateDto;
  stats: MeshStats;
  busy: string | null;
  run: (label: string, action: () => Promise<MeshPageStateDto>) => Promise<void>;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-[rgb(var(--accent)/0.36)] bg-[rgb(var(--panel)/0.82)] shadow-[0_0_0_1px_rgb(var(--foreground)/0.05),0_24px_80px_rgb(0_0_0/0.16)]">
      <div className="flex items-center justify-between border-b border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.42)] px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
          AITHY@MESH: /LAN
        </div>
      </div>
      <div className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "linear-gradient(rgb(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--foreground)) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative grid gap-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="font-mono text-xs text-[rgb(var(--accent))]">
              <span className="text-[rgb(var(--muted-foreground))]">$</span> aithyctl mesh --watch
              <span className="ml-1 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-[rgb(var(--accent))]" />
            </div>
            <label className="flex items-center gap-3 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.5)] px-3 py-2">
              <Power className="h-4 w-4 text-[rgb(var(--muted-foreground))]" />
              <span className="font-mono text-xs uppercase tracking-[0.16em]">mesh</span>
              <Switch
                checked={mesh.local.enabled}
                disabled={busy !== null}
                onCheckedChange={(enabled) => void run("enabled", () => saveMeshEnabled({ data: { enabled } }))}
              />
            </label>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <StatePill label={mesh.local.enabled ? "ONLINE" : "MESH DISABLED"} tone={mesh.local.enabled ? "ok" : "muted"} />
              <h2 className="mt-5 max-w-3xl font-mono text-2xl tracking-tight sm:text-4xl">
                {mesh.local.displayName}
              </h2>
              <p className="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
                {mesh.local.enabled ? "listening for trusted peers" : "mesh disabled"}
              </p>
            </div>
            <Button type="button" disabled={!mesh.local.enabled || busy !== null} onClick={() => void run("pairing", () => openMeshPairingWindow())}>
              <Shield className="h-4 w-4" />
              Open pairing
            </Button>
          </div>
          {mesh.local.pairing ? (
            <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.5)] px-3 py-2 font-mono text-xs">
              code <span className="ml-2 text-base font-semibold">{mesh.local.pairing.code}</span>
              <span className="ml-3 text-[rgb(var(--muted-foreground))]">expires {new Date(mesh.local.pairing.expiresAt).toLocaleTimeString()}</span>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Shield} label="paired" value={stats.paired} />
            <Metric icon={RadioTower} label="discovered" value={stats.discovered} />
            <Metric icon={Activity} label="online" value={stats.online} />
            <Metric icon={Cpu} label="shared" value={stats.shared} />
          </div>
        </div>
      </div>
    </section>
  );
}

function PairedPeers({
  mesh,
  busy,
  run,
}: {
  mesh: MeshStateDto;
  busy: string | null;
  run: (label: string, action: () => Promise<MeshPageStateDto>) => Promise<void>;
}) {
  return (
    <PeerPanel title="paired" count={mesh.paired.length}>
      {mesh.paired.length === 0 ? (
        <EmptyRow text="No trusted peers" />
      ) : mesh.paired.map((peer) => (
        <article key={peer.peerId} className="grid gap-3 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.44)] px-3 py-3">
          <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
            <Circle className={cn("h-2.5 w-2.5 fill-current", peerOnline(mesh, peer) ? "text-emerald-500" : "text-[rgb(var(--muted-foreground))]")} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-mono text-sm">{peer.name}</p>
                <StatePill label={peerStatus(mesh, peer)} tone={peerOnline(mesh, peer) ? "ok" : "muted"} />
                <StatePill label={peer.trustLevel.toUpperCase()} tone={peer.trustLevel === "family" ? "ok" : "neutral"} />
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-[rgb(var(--muted-foreground))]" title={peer.fingerprint}>
                fp:{shortFingerprint(peer.fingerprint)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 md:justify-end">
              <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void run(`revoke-${peer.peerId}`, () => revokeMeshPeer({ data: { peerId: peer.peerId } }))}>
                <X className="h-4 w-4" /> Revoke
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void run(`unpair-${peer.peerId}`, () => unpairMeshPeer({ data: { peerId: peer.peerId } }))}>
                Unpair
              </Button>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-[12rem_1fr_1fr]">
            <Field label="trust">
              <select
                className={selectClass}
                value={peer.trustLevel}
                disabled={busy !== null || peer.revoked}
                onChange={(event) => void run(`trust-${peer.peerId}`, () =>
                  setMeshPeerTrust({ data: { peerId: peer.peerId, trustLevel: event.target.value as MeshTrustLevel } })
                )}
              >
                <option value="acquaintance">Acquaintance</option>
                <option value="friend">Friend</option>
                <option value="family">Family</option>
              </select>
            </Field>
            <Datum label="last seen" value={peer.lastSeenAt ? new Date(peer.lastSeenAt).toLocaleString() : "never"} />
            <Datum label="services" value={serviceText(mesh, peer)} />
          </div>
        </article>
      ))}
    </PeerPanel>
  );
}

function DiscoveredPeers({
  mesh,
  pairCodes,
  setPairCodes,
  busy,
  run,
}: {
  mesh: MeshStateDto;
  pairCodes: Record<string, string>;
  setPairCodes: (updater: (current: Record<string, string>) => Record<string, string>) => void;
  busy: string | null;
  run: (label: string, action: () => Promise<MeshPageStateDto>) => Promise<void>;
}) {
  return (
    <PeerPanel title="discovered" count={mesh.discovered.length}>
      {!mesh.local.enabled ? (
        <EmptyRow text="mesh disabled" />
      ) : mesh.discovered.length === 0 ? (
        <EmptyRow text="No agents broadcasting" />
      ) : mesh.discovered.map((peer) => (
        <article key={peer.peerId} className="grid gap-3 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.44)] px-3 py-3">
          <div className="grid gap-3 md:grid-cols-[auto_1fr_auto] md:items-center">
            <Circle className={cn("h-2.5 w-2.5 fill-current", peer.verified && !peer.warning ? "text-emerald-500" : "text-amber-500")} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-mono text-sm">{peer.displayName}</p>
                <StatePill label={peer.warning ? "WARNING" : peer.verified ? "PAIRABLE" : "CHECKING"} tone={peer.warning ? "bad" : peer.verified ? "ok" : "neutral"} />
              </div>
              <p className="mt-1 truncate font-mono text-[11px] text-[rgb(var(--muted-foreground))]" title={peer.fingerprint}>
                {peer.host}:{peer.port} fp:{shortFingerprint(peer.fingerprint)}
              </p>
            </div>
          </div>
          {peer.warning ? <p className="font-mono text-xs text-amber-500">{peer.warning}</p> : null}
          <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
            <Field label="pair code">
              <input
                className={fieldClass}
                value={pairCodes[peer.peerId] ?? ""}
                onChange={(event) => setPairCodes((current) => ({ ...current, [peer.peerId]: event.target.value }))}
                placeholder="ABCD-EFGH-JKLM-NPQR"
              />
            </Field>
            <Button
              type="button"
              disabled={busy !== null || !(pairCodes[peer.peerId] ?? "").trim()}
              onClick={() => void run(`pair-${peer.peerId}`, () =>
                pairMeshPeer({ data: { peerId: peer.peerId, code: pairCodes[peer.peerId] ?? "" } })
              )}
            >
              <Link2 className="h-4 w-4" />
              Pair
            </Button>
          </div>
        </article>
      ))}
    </PeerPanel>
  );
}

function MeshSettings({
  mesh,
  busy,
  run,
}: {
  mesh: MeshStateDto;
  busy: string | null;
  run: (label: string, action: () => Promise<MeshPageStateDto>) => Promise<void>;
}) {
  return (
    <details className="group rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.72)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-2 font-mono text-sm">
          <ListTree className="h-4 w-4" />
          identity + sharing
        </span>
        <ChevronDown className="h-4 w-4 text-[rgb(var(--muted-foreground))] transition group-open:rotate-180" />
      </summary>
      <div className="grid gap-4 border-t border-[rgb(var(--border))] p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="grid gap-3">
            <Datum label="this aithy" value={mesh.local.displayName} />
            <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.46)] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">fingerprint</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(mesh.local.fingerprint)}>
                  <Clipboard className="h-4 w-4" />
                  Copy
                </Button>
              </div>
              <p className="break-all font-mono text-xs leading-5">{mesh.local.fingerprint}</p>
            </div>
          </div>
          <Button type="button" variant="ghost" disabled={busy !== null} onClick={() => void run("identity", () => regenerateMeshIdentity())}>
            <RotateCw className="h-4 w-4" />
            Regenerate identity
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SharingToggle
            label="offer inference"
            checked={mesh.local.sharing.inference}
            disabled={!mesh.local.enabled || busy !== null}
            onChange={(inference) => void run("sharing", () => saveMeshSharing({ data: { inference } }))}
          />
          <SharingToggle
            label="offer search"
            checked={mesh.local.sharing.search}
            disabled={!mesh.local.enabled || busy !== null}
            onChange={(search) => void run("sharing", () => saveMeshSharing({ data: { search } }))}
          />
        </div>
        {mesh.local.discoveryError || mesh.local.serverError ? (
          <p className="font-mono text-xs text-red-500">{mesh.local.discoveryError ?? mesh.local.serverError}</p>
        ) : null}
      </div>
    </details>
  );
}

function PeerPanel({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.72)]">
      <div className="flex items-center justify-between border-b border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.34)] px-3 py-2">
        <div className="font-mono text-xs text-[rgb(var(--accent))]">
          <span className="text-[rgb(var(--muted-foreground))]">$</span> meshctl {title}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
          {count}/{count}
        </div>
      </div>
      <div className="grid gap-2 p-3">{children}</div>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.46)] px-3 py-2">
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 font-mono text-2xl">{value}</div>
    </div>
  );
}

function Datum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.46)] px-3 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">{label}</p>
      <p className="mt-1 truncate text-sm" title={value}>{value}</p>
    </div>
  );
}

function StatePill({ label, tone }: { label: string; tone: "ok" | "neutral" | "muted" | "bad" }) {
  return (
    <span className={cn(
      "inline-flex rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em]",
      tone === "ok" && "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
      tone === "neutral" && "border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.32)] text-[rgb(var(--accent))]",
      tone === "muted" && "border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.32)] text-[rgb(var(--muted-foreground))]",
      tone === "bad" && "border-red-500/35 bg-red-500/10 text-red-500",
    )}>
      {label}
    </span>
  );
}

function SharingToggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--background)/0.46)] px-3">
      <span className="font-mono text-xs uppercase tracking-[0.14em]">{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[rgb(var(--border))] px-3 py-4 font-mono text-sm text-[rgb(var(--muted-foreground))]">
      {text}
    </div>
  );
}

interface MeshStats {
  paired: number;
  discovered: number;
  online: number;
  shared: number;
}

function meshStats(mesh: MeshStateDto): MeshStats {
  return {
    paired: mesh.paired.length,
    discovered: mesh.discovered.length,
    online: mesh.paired.filter((peer) => peer.status === "online" && !peer.revoked).length
      + mesh.discovered.filter((peer) => peer.verified && !peer.warning).length,
    shared: [mesh.local.sharing.inference, mesh.local.sharing.search].filter(Boolean).length,
  };
}

function peerOnline(mesh: MeshStateDto, peer: MeshStateDto["paired"][number]): boolean {
  return mesh.local.enabled && peer.status === "online" && !peer.revoked;
}

function peerStatus(mesh: MeshStateDto, peer: MeshStateDto["paired"][number]): string {
  if (!mesh.local.enabled) return "OFFLINE";
  if (peer.revoked) return "REVOKED";
  return peer.status.toUpperCase();
}

function serviceText(mesh: MeshStateDto, peer: MeshStateDto["paired"][number]): string {
  if (!mesh.local.enabled) return "mesh disabled";
  if (peer.trustLevel !== "family" || peer.remoteTrustLevel !== "family") return "presence only";
  return peer.serviceCatalog.length ? peer.serviceCatalog.map((service) => service.label).join(", ") : "none";
}

function shortFingerprint(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
}
