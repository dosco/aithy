import { useState } from "react";
import { PageFrame } from "@/components/page-frame";
import { SettingsDangerZone } from "@/components/settings-danger-zone";
import { networkValue } from "@/components/settings-page-helpers";
import {
  AgentSettingsSection,
  UserProfileSection,
} from "@/components/settings-identity-sections";
import { SandboxSettingsTab } from "@/components/settings-sandbox-tab";
import { ObservabilitySettingsTab } from "@/components/settings-observability-tab";
import { SearchSettingsTab } from "@/components/settings-search-tab";
import { PermissionsSettingsTab } from "@/components/settings-permissions-tab";
import { McpSettingsTab } from "@/components/settings-mcp-tab";
import { ThemeSync } from "@/components/theme-sync";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { saveSettingsWithSetupGateRefresh } from "@/lib/setup-gate";
import { getMeshFamilyCatalogs } from "@/server/actions.functions";
import type {
  MeshLiveCatalogPeerDto,
  ProfileDto,
  SettingsPageStateDto,
  SoulDto,
} from "@/server/dto";

export function SettingsPage({ initialState }: { initialState: SettingsPageStateDto }) {
  const [config, setConfig] = useState(initialState.config);
  const [parallelSearch, setParallelSearch] = useState(initialState.parallelSearch);
  const [parallelApiKey, setParallelApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [skippedPaths, setSkippedPaths] = useState<string[]>([]);
  const [soul, setSoul] = useState<SoulDto>(initialState.soul);
  const [profile, setProfile] = useState<ProfileDto>(initialState.profile);
  const [ui, setUi] = useState(initialState.settings.ui);
  const [permissionRules, setPermissionRules] = useState(initialState.permissionRules);
  const [meshCatalogs, setMeshCatalogs] = useState<MeshLiveCatalogPeerDto[]>(initialState.meshCatalogs);

  async function save(options?: {
    section?: "search" | "sandbox" | "observability";
    clearParallelApiKey?: boolean;
  }) {
    setSaveBusy(true);
    setSaveError(null);
    try {
      const result = await saveSettingsWithSetupGateRefresh({
        data: {
          runtime: {
            sandboxProvider:
              config.sandboxProvider === "disabled"
                ? "disabled"
                : "microsandbox",
            sandboxImageSelection: config.sandboxImageSelection,
            customSandboxImages: config.customSandboxImages
              .map((image) => ({
                id: image.id.trim(),
                name: image.name.trim(),
                image: image.image.trim(),
              }))
              .filter((image) => image.id && image.name && image.image),
            sandboxCpus: Number(config.sandboxCpus),
            sandboxMemoryMb: Number(config.sandboxMemoryMb),
            sandboxNetwork: networkValue(config.sandboxNetwork),
            sessionTtlMs: Number(config.sessionTtlMs),
            parallelAgents: Number(config.parallelAgents),
            ...(options?.section === "search"
              ? {
                searchProvider: config.searchProvider,
                parallelSearchMcpUrl: config.parallelSearchMcpUrl.trim() || null,
              }
              : {}),
            systemBashEnabled: config.systemBashEnabled,
            trainingDataCaptureEnabled: config.trainingDataCaptureEnabled,
            playbookLearningEnabled: config.playbookLearningEnabled,
            globalMounts: config.globalMounts
              .map((m) => ({ hostPath: m.hostPath.trim() }))
              .filter((m) => m.hostPath.length > 0),
          },
          ui: {
            detailsDefault: ui.detailsDefault,
          },
          parallelApiKey: options?.section === "search" && !options?.clearParallelApiKey ? parallelApiKey || undefined : undefined,
          clearParallelApiKey: options?.section === "search" ? options?.clearParallelApiKey : undefined,
        },
      });
      setConfig(result.config);
      setUi(result.settings.ui);
      setParallelSearch(result.parallelSearch);
      setParallelApiKey("");
      setSkippedPaths(result.skippedPaths ?? []);
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save settings",
      );
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <PageFrame
      eyebrow="Control room"
      title="Local settings, search, sandbox shape."
    >
      <ThemeSync ui={ui} />
      <Tabs defaultValue="search">
        <TabsList className="mb-6">
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="observability">Data</TabsTrigger>
          <TabsTrigger value="sandbox">Sandbox</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="mcp">MCP</TabsTrigger>
          <TabsTrigger value="profile">User</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        {saveError ? (
          <p
            className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500"
            role="alert"
          >
            {saveError}
          </p>
        ) : null}

        <TabsContent value="search">
          <SearchSettingsTab
            config={config}
            setConfig={setConfig}
            parallelSearch={parallelSearch}
            parallelApiKey={parallelApiKey}
            setParallelApiKey={setParallelApiKey}
            saved={saved}
            saveBusy={saveBusy}
            onSave={() => void save({ section: "search" })}
            onClearApiKey={() => void save({ section: "search", clearParallelApiKey: true })}
            meshCatalogs={meshCatalogs}
            onRefreshMeshCatalogs={() => {
              void getMeshFamilyCatalogs({ data: { kind: "search" } }).then(setMeshCatalogs);
            }}
          />
        </TabsContent>

        <TabsContent value="sandbox">
          <SandboxSettingsTab
            config={config}
            setConfig={setConfig}
            skippedPaths={skippedPaths}
            saved={saved}
            saveBusy={saveBusy}
            onSave={() => void save({ section: "sandbox" })}
          />
        </TabsContent>

        <TabsContent value="observability">
          <ObservabilitySettingsTab
            config={config}
            setConfig={setConfig}
            saved={saved}
            saveBusy={saveBusy}
            onSave={() => void save({ section: "observability" })}
          />
        </TabsContent>

        <TabsContent value="permissions">
          <PermissionsSettingsTab
            rules={permissionRules}
            onRulesChange={setPermissionRules}
          />
        </TabsContent>

        <TabsContent value="mcp"><McpSettingsTab initial={initialState.mcpStatus} /></TabsContent>

        <TabsContent value="profile">
          <UserProfileSection profile={profile} onChange={setProfile} />
        </TabsContent>

        <TabsContent value="agent">
          <AgentSettingsSection
            soul={soul}
            profile={profile}
            onSoulChange={setSoul}
            onProfileChange={setProfile}
          />
        </TabsContent>

        <TabsContent value="system">
          <SettingsDangerZone
            onSystemReset={(state) => {
              setConfig(state.config);
              setParallelSearch(state.parallelSearch);
              setSoul(state.soul);
              setProfile(state.profile);
              setUi(state.settings.ui);
              setPermissionRules(state.permissionRules);
              setParallelApiKey("");
              setSkippedPaths([]);
            }}
          />
        </TabsContent>
      </Tabs>

      <div className="mt-8 border-t border-[rgb(var(--border))] pt-5">
        <p className="text-xs text-[rgb(var(--muted-foreground))]">
          State: <code>~/.config/aithy/{config.botId}/</code>. API keys are
          stored in the encrypted secrets store.
        </p>
      </div>
    </PageFrame>
  );
}
