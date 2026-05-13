import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageFrame } from "@/components/page-frame";
import { SettingsDangerZone } from "@/components/settings-danger-zone";
import {
  type PrimaryClearAction,
  networkValue,
  primaryClearCopy,
} from "@/components/settings-page-helpers";
import {
  AgentSettingsSection,
  UserProfileSection,
} from "@/components/settings-identity-sections";
import { ModelSettingsTab, SandboxSettingsTab } from "@/components/settings-runtime-tabs";
import { ThemeSync } from "@/components/theme-sync";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { saveSettingsWithSetupGateRefresh } from "@/lib/setup-gate";
import type {
  ProfileDto,
  SecretStatusDto,
  SettingsPageStateDto,
  SoulDto,
} from "@/server/dto";

export function SettingsPage({ initialState }: { initialState: SettingsPageStateDto }) {
  const router = useRouter();
  const [config, setConfig] = useState(initialState.config);
  const [secret, setSecret] = useState(initialState.secret);
  const [fastSecret, setFastSecret] = useState<SecretStatusDto | null>(
    initialState.fastSecret,
  );
  const [apiKey, setApiKey] = useState("");
  const [fastApiKey, setFastApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [skippedPaths, setSkippedPaths] = useState<string[]>([]);
  const [soul, setSoul] = useState<SoulDto>(initialState.soul);
  const [profile, setProfile] = useState<ProfileDto>(initialState.profile);
  const [ui, setUi] = useState(initialState.settings.ui);
  const [primaryClearAction, setPrimaryClearAction] =
    useState<PrimaryClearAction | null>(null);
  const [primaryClearBusy, setPrimaryClearBusy] = useState(false);

  async function save(options?: {
    clearApiKey?: boolean;
    clearAiModel?: boolean;
  }) {
    const clearAiModel =
      options?.clearAiModel ?? config.aiModel.trim().length === 0;
    setSaveBusy(true);
    setSaveError(null);
    try {
      const result = await saveSettingsWithSetupGateRefresh({
        data: {
          runtime: {
            aiProvider: config.aiProvider,
            aiModel: clearAiModel ? null : config.aiModel,
            fastAiProvider: config.fastAiProvider,
            fastAiModel: config.fastAiModel,
            sandboxProvider:
              config.sandboxProvider === "disabled"
                ? "disabled"
                : "microsandbox",
            sandboxImage: config.sandboxImage,
            sandboxCpus: Number(config.sandboxCpus),
            sandboxMemoryMb: Number(config.sandboxMemoryMb),
            sandboxNetwork: networkValue(config.sandboxNetwork),
            sessionTtlMs: Number(config.sessionTtlMs),
            parallelAgents: Number(config.parallelAgents),
            traceEnabled: config.traceEnabled,
            globalMounts: config.globalMounts
              .map((m) => ({ hostPath: m.hostPath.trim() }))
              .filter((m) => m.hostPath.length > 0),
          },
          ui: {
            detailsDefault: ui.detailsDefault,
          },
          apiKey: options?.clearApiKey ? undefined : apiKey || undefined,
          clearApiKey: options?.clearApiKey,
          clearAiModel,
          fastApiKey: fastApiKey || undefined,
        },
      });
      setConfig(result.config);
      setUi(result.settings.ui);
      setSecret(result.secret);
      setFastSecret(result.fastSecret);
      setApiKey("");
      setFastApiKey("");
      setSkippedPaths(result.skippedPaths ?? []);
      if (!result.aiConfigured && (options?.clearApiKey || clearAiModel)) {
        await router.navigate({ to: "/chat" });
        return;
      }
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

  async function clearPrimary(action: PrimaryClearAction) {
    setPrimaryClearBusy(true);
    try {
      await save(
        action === "model" ? { clearAiModel: true } : { clearApiKey: true },
      );
    } finally {
      setPrimaryClearBusy(false);
      setPrimaryClearAction(null);
    }
  }

  return (
    <PageFrame
      eyebrow="Control room"
      title="Local settings, model wiring, sandbox shape."
    >
      <ThemeSync ui={ui} />
      <Tabs defaultValue="model">
        <TabsList className="mb-6">
          <TabsTrigger value="model">Model</TabsTrigger>
          <TabsTrigger value="sandbox">Sandbox</TabsTrigger>
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

        <TabsContent value="model">
          <ModelSettingsTab
            config={config}
            setConfig={setConfig}
            secret={secret}
            fastSecret={fastSecret}
            apiKey={apiKey}
            fastApiKey={fastApiKey}
            setApiKey={setApiKey}
            setFastApiKey={setFastApiKey}
            setPrimaryClearAction={setPrimaryClearAction}
            saved={saved}
            saveBusy={saveBusy}
            onSave={() => void save()}
          />
        </TabsContent>

        <TabsContent value="sandbox">
          <SandboxSettingsTab
            config={config}
            setConfig={setConfig}
            skippedPaths={skippedPaths}
            saved={saved}
            saveBusy={saveBusy}
            onSave={() => void save()}
          />
        </TabsContent>

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
              setSecret(state.secret);
              setFastSecret(state.fastSecret);
              setSoul(state.soul);
              setProfile(state.profile);
              setUi(state.settings.ui);
              setApiKey("");
              setFastApiKey("");
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
      <ConfirmDialog
        open={primaryClearAction !== null}
        title={primaryClearCopy(primaryClearAction).title}
        body={primaryClearCopy(primaryClearAction).body}
        confirmLabel={primaryClearCopy(primaryClearAction).confirmLabel}
        busy={primaryClearBusy}
        onCancel={() => setPrimaryClearAction(null)}
        onConfirm={() => {
          if (primaryClearAction) void clearPrimary(primaryClearAction);
        }}
      />
    </PageFrame>
  );
}
