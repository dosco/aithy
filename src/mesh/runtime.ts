import type { Bonjour, Browser, Service } from "bonjour-service";
import type { AppConfig } from "../config/env";
import type { RuntimeStore } from "../runtime/runtime-store";
import type { StoredSettings } from "../settings/types";
import type { SqliteUsageStore } from "../usage/usage-store";
import { localMeshLiveCatalog, resolveMeshInferenceService, resolveMeshSearchService } from "./catalog";
import { jsonResponse, meshPublicIdentity, validateMeshHello, viteCliPort, type MeshHelloBody } from "./http";
import { loadOrCreateMeshIdentity, regenerateMeshIdentity, updateMeshIdentityDisplayName, type MeshIdentityMaterial } from "./identity";
import { generatePairingCode } from "./pairing";
import { meshProxyBaseUrl, meshSearchProxyUrl } from "./proxy-url";
import { pruneDiscoveredPeers, publishMeshService, removeDiscoveredMeshPeer, startMeshDiscovery, upsertDiscoveredMeshPeer, verifyDiscoveredMeshPeer } from "./runtime-discovery";
import { handleMeshPairRequest, pairWithDiscoveredMeshPeer, type ActivePairing, type MeshPairResponse } from "./runtime-pairing";
import { liveCatalogPeers, validateMeshInferenceSelection, validateMeshSearchSelection } from "./runtime-live";
import { callMeshPeer, handleMeshRpc, healthcheckMeshPeers, requireCallablePeer, type MeshRpcRuntimeDeps } from "./runtime-rpc";
import { chooseMeshPort, startMeshServers } from "./runtime-server";
import { assertMeshProxyRequest, readMeshJson } from "./server-guards";
import { SqliteMeshStore } from "./store";
import { certificateFingerprint } from "./tls-cert";
import { fetchPinnedMeshJson, fetchUnverifiedMeshJson, meshHttpsUrl, probeMeshCertificate, type MeshFetchResult } from "./transport";
import { recordMeshCallerUsage } from "./usage";
import { MESH_HEALTHCHECK_INTERVAL_MS, MESH_PAIRING_TTL_MS, type DiscoveredMeshPeer, type MeshLiveCatalog, type MeshLiveCatalogPeer, type MeshPairingWindow, type MeshPeerRecord, type MeshRpcEnvelope, type MeshSnapshot, type MeshTrustLevel } from "./types";
const MAX_PAIRING_FAILURES = 8;
interface MeshRuntimeOptions {
  botId: string;
  stateDbPath: string;
  displayName: () => string;
  config: () => AppConfig;
  settings: () => StoredSettings;
  runtimeStore: () => RuntimeStore;
  usage: () => SqliteUsageStore;
  fetchImpl?: typeof fetch;
}
export class MeshRuntime {
  readonly store: SqliteMeshStore;
  private readonly discovered = new Map<string, DiscoveredMeshPeer>();
  private bonjour: Bonjour | null = null;
  private browser: Browser | null = null;
  private service: Service | null = null;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private proxyServer: ReturnType<typeof Bun.serve> | null = null;
  private healthTimer?: Timer;
  private identity: MeshIdentityMaterial | null = null;
  private pairing: ActivePairing | null = null;
  private http3Enabled = false;
  private discoveryError: string | null = null;
  private serverError: string | null = null;
  private started = false;
  constructor(private readonly options: MeshRuntimeOptions) {
    this.store = new SqliteMeshStore(options.stateDbPath);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.identity = await loadOrCreateMeshIdentity(this.options.botId, this.store, this.displayName());
    if (this.store.meshEnabled()) {
      await this.startMeshServices();
    } else {
      this.store.markAllOffline();
    }
  }

  snapshot(now = new Date()): MeshSnapshot {
    const enabled = this.store.meshEnabled();
    if (enabled) pruneDiscoveredPeers(this.discovered, now);
    const local = this.requireIdentity();
    return {
      local: {
        ...meshPublicIdentity(local),
        enabled,
        supportsHttp3: this.http3Enabled,
        port: this.port(),
        sharing: this.store.sharing(),
        pairing: enabled ? this.currentPairing() : null,
        discoveryError: enabled ? this.discoveryError : null,
        serverError: enabled ? this.serverError : null,
      },
      discovered: enabled
        ? [...this.discovered.values()]
          .filter((peer) => peer.peerId !== local.peerId)
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
        : [],
      paired: this.store.peers(),
      inferenceProviders: [],
      searchProviders: [],
    };
  }

  openPairingWindow(): MeshPairingWindow {
    this.assertEnabled();
    const code = generatePairingCode();
    this.pairing = {
      code,
      expiresAt: new Date(Date.now() + MESH_PAIRING_TTL_MS).toISOString(),
      windowId: crypto.randomUUID(),
      used: false,
      failures: 0,
    };
    return { code, expiresAt: this.pairing.expiresAt };
  }

  async pairWithDiscoveredPeer(peerId: string, code: string): Promise<MeshPeerRecord> {
    this.assertEnabled();
    return pairWithDiscoveredMeshPeer({
      peerId,
      code,
      discovered: this.discovered.get(peerId),
      store: this.store,
      helloBody: () => this.helloBody(),
      fetchHello: (host, port) => this.fetchHello(host, port),
      fetchUnverifiedJson: (host, port, path, observed, init) => this.fetchUnverifiedJson(host, port, path, observed, init),
      assertHelloCertificate: (hello) => this.assertHelloCertificate(hello),
    });
  }

  setTrustLevel(peerId: string, trustLevel: MeshTrustLevel): MeshPeerRecord {
    return this.store.setTrustLevel(peerId, trustLevel);
  }

  updateSharing(patch: Partial<{ inference: boolean; search: boolean }>) {
    return this.store.saveSharing(patch);
  }

  async setEnabled(enabled: boolean): Promise<MeshSnapshot> {
    this.store.saveMeshEnabled(enabled);
    if (!this.identity) {
      this.identity = await loadOrCreateMeshIdentity(this.options.botId, this.store, this.displayName());
    }
    if (enabled) {
      await this.startMeshServices();
    } else {
      this.stopMeshServices(true);
    }
    return this.snapshot();
  }

  refreshDisplayName(): void {
    if (!this.identity) return;
    const displayName = this.displayName();
    if (this.identity.displayName === displayName) return;
    this.identity = updateMeshIdentityDisplayName(this.store, this.identity, displayName);
    if (this.store.meshEnabled()) this.publish();
  }

  revokePeer(peerId: string): MeshPeerRecord {
    const peer = this.store.revokePeer(peerId);
    if (this.store.meshEnabled()) void this.callPeer(peer, "revoke", {}).catch(() => undefined);
    return peer;
  }

  unpairPeer(peerId: string): void {
    const peer = this.store.peer(peerId);
    if (peer && this.store.meshEnabled()) void this.callPeer(peer, "unpair", {}).catch(() => undefined);
    this.store.unpairPeer(peerId);
  }

  async regenerateIdentity(): Promise<MeshSnapshot> {
    this.store.unpairAll();
    this.identity = await regenerateMeshIdentity(this.options.botId, this.store, this.displayName());
    if (this.store.meshEnabled()) this.publish();
    return this.snapshot();
  }

  proxyBaseUrl(peerId: string, serviceId = "default"): string {
    this.assertEnabled();
    const port = this.proxyServer?.port ?? this.port();
    if (!port) throw new Error("Mesh API server is not ready.");
    return meshProxyBaseUrl(port, peerId, serviceId);
  }

  searchProxyUrl(peerId: string, serviceId: string): string {
    this.assertEnabled();
    const port = this.proxyServer?.port ?? this.port();
    if (!port) throw new Error("Mesh API server is not ready.");
    return meshSearchProxyUrl(port, peerId, serviceId);
  }

  async liveCatalogs(kind: "inference" | "search" | "all" = "all"): Promise<MeshLiveCatalogPeer[]> {
    if (!this.store.meshEnabled()) return [];
    return liveCatalogPeers(this.store.peers(), kind, (peer, method, payload) => this.callPeer(peer, method, payload));
  }

  async validateInferenceSelection(providerId: string, model: string): Promise<void> {
    this.assertEnabled();
    return validateMeshInferenceSelection({
      providerId,
      model,
      requirePeer: (peerId, kind, serviceId) => this.requireCallablePeer(peerId, kind, serviceId),
      callPeer: (peer, method, payload) => this.callPeer(peer, method, payload),
    });
  }

  async validateSearchSelection(providerId: string): Promise<void> {
    this.assertEnabled();
    return validateMeshSearchSelection({
      providerId,
      requirePeer: (peerId, kind, serviceId) => this.requireCallablePeer(peerId, kind, serviceId),
      callPeer: (peer, method, payload) => this.callPeer(peer, method, payload),
    });
  }

  async callSearchProvider(peerId: string, serviceId: string, input: unknown): Promise<unknown> {
    this.assertEnabled();
    const peer = this.requireCallablePeer(peerId, "search", serviceId);
    return this.callPeer(peer, "search.query", { serviceId, input });
  }

  async close(): Promise<void> {
    this.stopMeshServices(false);
    this.started = false;
    this.store.close();
  }

  private async startMeshServices(): Promise<void> {
    if (this.server) return;
    await this.startServer();
    this.startDiscovery();
    this.publish();
    this.healthTimer = setInterval(() => void this.healthcheck(), MESH_HEALTHCHECK_INTERVAL_MS);
    this.healthTimer.unref();
    void this.healthcheck();
  }

  private stopMeshServices(markOffline: boolean): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = undefined;
    this.browser?.stop();
    this.service?.stop?.();
    this.bonjour?.destroy();
    this.server?.stop(true);
    this.proxyServer?.stop(true);
    this.browser = null;
    this.service = null;
    this.bonjour = null;
    this.server = null;
    this.proxyServer = null;
    this.discovered.clear();
    this.pairing = null;
    this.http3Enabled = false;
    this.discoveryError = null;
    this.serverError = null;
    if (markOffline) this.store.markAllOffline();
  }

  private async startServer(): Promise<void> {
    const fetchHandler = (req: Request, server: ReturnType<typeof Bun.serve>) => this.handleRequest(req, server);
    const preferred = this.store.preferredPort();
    const port = await chooseMeshPort(preferred === viteCliPort() ? null : preferred);
    try {
      this.applyServers(startMeshServers({ port, fetchHandler, identity: this.requireIdentity() }));
    } catch (error) {
      this.serverError = error instanceof Error ? error.message : String(error);
      this.applyServers(startMeshServers({ port: await chooseMeshPort(null), fetchHandler, identity: this.requireIdentity() }));
    }
    const server = this.server;
    if (!server?.port) throw new Error("Mesh API server did not expose a port.");
    this.serverError = null;
    this.store.savePreferredPort(server.port);
  }

  private applyServers(result: ReturnType<typeof startMeshServers>): void {
    this.server = result.server;
    this.proxyServer = result.proxyServer;
    this.http3Enabled = result.http3Enabled;
    if (this.proxyServer?.port) this.store.saveProxyPort(this.proxyServer.port);
    if (result.serverError) this.serverError = result.serverError;
  }
  private startDiscovery(): void {
    const result = startMeshDiscovery({
      onUp: (service) => {
        if (!this.store.meshEnabled()) return;
        upsertDiscoveredMeshPeer({
          service,
          discovered: this.discovered,
          localPeerId: this.identity?.peerId,
          verify: (peer) => verifyDiscoveredMeshPeer({
            peer,
            discovered: this.discovered,
            fetchHello: (host, port) => this.fetchHello(host, port),
          }),
        });
      },
      onDown: (service) => removeDiscoveredMeshPeer(this.discovered, service),
      onError: (message) => {
        this.discoveryError = message;
      },
    });
    this.bonjour = result.bonjour;
    this.browser = result.browser;
    this.discoveryError = result.error;
  }
  private publish(): void {
    this.service = publishMeshService({
      bonjour: this.bonjour,
      current: this.service,
      identity: this.requireIdentity(),
      port: this.server?.port ?? null,
      supportsHttp3: this.http3Enabled,
    });
  }

  private async handleRequest(req: Request, server: ReturnType<typeof Bun.serve>): Promise<Response> {
    try {
      this.assertEnabled();
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/mesh/hello") return jsonResponse(this.helloBody());
      if (req.method === "POST" && url.pathname === "/mesh/pair") return jsonResponse(await this.handlePair(await readMeshJson(req)));
      if (req.method === "POST" && url.pathname === "/mesh/rpc") return jsonResponse(await this.handleRpc(await readMeshJson(req)));
      if (req.method === "POST" && url.pathname.startsWith("/mesh/proxy/")) {
        assertMeshProxyRequest(req, server.requestIP(req)?.address);
        return jsonResponse(await this.handleLocalProxy(url.pathname, await readMeshJson(req)));
      }
      return jsonResponse({ error: "not found" }, 404);
    } catch (error) {
      return jsonResponse({ error: error instanceof Error ? error.message : "Mesh request failed" }, 400);
    }
  }

  private async handlePair(input: unknown): Promise<MeshPairResponse> {
    return handleMeshPairRequest({
      body: input,
      pairing: this.pairing,
      store: this.store,
      helloBody: () => this.helloBody(),
      assertHelloCertificate: (hello) => this.assertHelloCertificate(hello),
      recordPairingFailure: () => this.recordPairingFailure(),
      markPairingUsed: () => {
        if (this.pairing) this.pairing.used = true;
      },
    });
  }

  private async handleRpc(input: unknown): Promise<MeshRpcEnvelope> {
    return handleMeshRpc(input, this.rpcDeps());
  }

  private async handleLocalProxy(pathname: string, body: unknown): Promise<unknown> {
    const [, , , rawPeerId, kind, rawServiceId, ...rest] = pathname.split("/");
    const peerId = decodeURIComponent(rawPeerId ?? "");
    const serviceId = decodeURIComponent(rawServiceId ?? "");
    if (kind === "search") return this.callSearchProvider(peerId, serviceId, body);
    if (kind !== "inference") throw new Error("Unsupported mesh proxy kind.");
    const peer = this.requireCallablePeer(peerId, "inference", serviceId);
    const response = await this.callPeer(peer, "inference.openai", { serviceId, path: `/${rest.join("/")}`, body });
    recordMeshCallerUsage(this.options.usage(), `mesh:${peerId}`, body);
    return response;
  }

  private async healthcheck(): Promise<void> {
    if (!this.store.meshEnabled()) return;
    await healthcheckMeshPeers(this.rpcDeps());
  }

  private async callPeer(peer: MeshPeerRecord, method: string, payload: unknown): Promise<unknown> {
    this.assertEnabled();
    return callMeshPeer(peer, method, payload, this.rpcDeps());
  }

  private localCatalog(): Promise<MeshLiveCatalog> {
    return localMeshLiveCatalog({
      config: this.options.config(),
      settings: this.options.settings().runtime,
      sharing: this.store.sharing(),
      runtimeStore: this.options.runtimeStore(),
    });
  }

  private requireCallablePeer(peerId: string, kind: "inference" | "search", serviceId: string): MeshPeerRecord {
    return requireCallablePeer(this.store, peerId, kind, serviceId);
  }

  private helloBody(): MeshHelloBody {
    const identity = this.requireIdentity();
    return {
      ...meshPublicIdentity(identity),
      supportsHttp3: this.http3Enabled,
      port: this.port() ?? 0,
      pairingOpen: Boolean(this.currentPairing()),
      pairingWindowId: this.currentPairing() ? this.pairing?.windowId ?? null : null,
    };
  }

  private async fetchHello(host: string, port: number, peer?: MeshPeerRecord): Promise<MeshHelloBody> {
    const observed = peer?.certificatePem
      ? { certificatePem: peer.certificatePem, fingerprint: peer.fingerprint }
      : await probeMeshCertificate(host, port);
    const hello = validateMeshHello(await this.fetchUnverifiedJson(host, port, "/mesh/hello", observed));
    await this.assertHelloCertificate(hello);
    if (hello.fingerprint !== observed.fingerprint) throw new Error("Mesh TLS certificate fingerprint mismatch.");
    return hello;
  }

  private async assertHelloCertificate(hello: MeshHelloBody): Promise<void> {
    const actual = await certificateFingerprint(hello.certificatePem);
    if (actual !== hello.fingerprint) throw new Error("Mesh certificate fingerprint mismatch.");
  }

  private async fetchUnverifiedJson<T>(
    host: string,
    port: number,
    path: string,
    observed: { certificatePem: string; fingerprint: string },
    init?: RequestInit,
  ): Promise<T> {
    return fetchUnverifiedMeshJson<T>({
      fetchImpl: this.options.fetchImpl ?? fetch,
      url: meshHttpsUrl(host, port, path),
      init,
      certificatePem: observed.certificatePem,
      fingerprint: observed.fingerprint,
    });
  }

  private async fetchPinnedJson<T>(
    peer: MeshPeerRecord,
    path: string,
    init?: RequestInit,
  ): Promise<MeshFetchResult<T>> {
    if (!peer.host || !peer.port || !peer.certificatePem) throw new Error("Mesh peer is offline.");
    return fetchPinnedMeshJson<T>({
      fetchImpl: this.options.fetchImpl ?? fetch,
      url: meshHttpsUrl(peer.host, peer.port, path),
      init,
      certificatePem: peer.certificatePem,
      fingerprint: peer.fingerprint,
      preferHttp3: peer.supportsHttp3,
    });
  }

  private rpcDeps(): MeshRpcRuntimeDeps {
    return {
      store: this.store,
      localPeerId: () => this.requireIdentity().peerId,
      localPrivateKeyPem: () => this.requireIdentity().privateKeyPem,
      config: this.options.config,
      runtimeStore: this.options.runtimeStore,
      localCatalog: () => this.localCatalog(),
      resolveInferenceService: (serviceId, model) => resolveMeshInferenceService({
        config: this.options.config(),
        settings: this.options.settings().runtime,
        sharing: this.store.sharing(),
        runtimeStore: this.options.runtimeStore(),
        serviceId,
        requestedModel: model,
      }),
      resolveSearchService: (serviceId) => resolveMeshSearchService({
        config: this.options.config(),
        settings: this.options.settings().runtime,
        sharing: this.store.sharing(),
        runtimeStore: this.options.runtimeStore(),
        serviceId,
      }),
      discoveredPeer: (peerId) => this.discovered.get(peerId),
      fetchHello: (host, port, peer) => this.fetchHello(host, port, peer),
      fetchPinnedJson: (peer, path, init) => this.fetchPinnedJson(peer, path, init),
    };
  }

  private currentPairing(): MeshPairingWindow | null {
    if (!this.pairing || this.pairing.used || Date.parse(this.pairing.expiresAt) <= Date.now()) return null;
    return { code: this.pairing.code, expiresAt: this.pairing.expiresAt };
  }

  private recordPairingFailure(): void {
    if (!this.pairing) return;
    this.pairing.failures += 1;
    if (this.pairing.failures >= MAX_PAIRING_FAILURES) this.pairing.used = true;
  }

  private port(): number | null {
    return this.server?.port ?? null;
  }

  private displayName(): string {
    return this.options.displayName().trim() || "Aithy";
  }

  private assertEnabled(): void {
    if (!this.store.meshEnabled()) throw new Error("Aithy Mesh is disabled.");
  }

  private requireIdentity(): MeshIdentityMaterial {
    if (!this.identity) throw new Error("Mesh identity is not ready.");
    return this.identity;
  }
}
