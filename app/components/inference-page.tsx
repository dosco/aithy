import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LocalInferencePanel } from "@/components/local-inference-page";
import { PageFrame } from "@/components/page-frame";
import {
  type PrimaryClearAction,
  primaryClearCopy,
} from "@/components/settings-page-helpers";
import { ModelSettingsTab } from "@/components/settings-runtime-tabs";
import { ThemeSync } from "@/components/theme-sync";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { saveSettingsWithSetupGateRefresh } from "@/lib/setup-gate";
import {
  logoutGrokSubscriptionSignIn,
  pollGrokSubscriptionSignIn,
  startGrokSubscriptionSignIn,
} from "@/server/actions.functions";
import type {
  GrokSubscriptionStatusDto,
  LocalInferencePageStateDto,
  SecretStatusDto,
  SettingsPageStateDto,
} from "@/server/dto";
import { CUSTOM_OPENAI_PROVIDER, isLocalAiProvider } from "../../src/agent/ai-providers";

export function InferencePage({
  initialState,
}: {
  initialState: {
    settings: SettingsPageStateDto;
    localInference: LocalInferencePageStateDto;
  };
}) {
  const router = useRouter();
  const [config, setConfig] = useState(initialState.settings.config);
  const [secret, setSecret] = useState(initialState.settings.secret);
  const [grokSubscription, setGrokSubscription] = useState<GrokSubscriptionStatusDto>(
    initialState.settings.grokSubscription,
  );
  const [fastSecret, setFastSecret] = useState<SecretStatusDto | null>(
    initialState.settings.fastSecret,
  );
  const [apiKey, setApiKey] = useState("");
  const [fastApiKey, setFastApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [grokBusy, setGrokBusy] = useState(false);
  const [grokError, setGrokError] = useState<string | null>(null);
  const [ui, setUi] = useState(initialState.settings.settings.ui);
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
            aiApiUrl:
              config.aiProvider === CUSTOM_OPENAI_PROVIDER
                ? config.aiApiUrl.trim()
                : null,
            aiModel: clearAiModel ? null : config.aiModel,
            localAgentModel: selectedLocalAgentModel(config),
            fastAiProvider: config.fastAiProvider,
            fastAiApiUrl:
              config.fastAiProvider === CUSTOM_OPENAI_PROVIDER
                ? config.fastAiApiUrl.trim()
                : null,
            fastAiModel: config.fastAiModel,
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
      setGrokSubscription(result.grokSubscription);
      setApiKey("");
      setFastApiKey("");
      if (!result.aiConfigured && (options?.clearApiKey || clearAiModel)) {
        await router.navigate({ to: "/chat" });
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Failed to save inference settings",
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

  async function signInWithGrok() {
    setGrokBusy(true);
    setGrokError(null);
    try {
      const started = await startGrokSubscriptionSignIn();
      setGrokSubscription(started.status);
      const opened = window.open(started.authorizeUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        throw new Error("Could not open the Grok sign-in window. Allow popups for Aithy and try again.");
      }
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await delay(1500);
        const next = await pollGrokSubscriptionSignIn({ data: { loginId: started.loginId } });
        setGrokSubscription(next.status);
        setConfig(next.config);
        setSecret(next.secret);
        setFastSecret(next.fastSecret);
        if (next.state !== "signing_in") {
          if (next.state !== "connected") setGrokError(next.message);
          return;
        }
      }
      setGrokError("Grok sign-in is still waiting. Retry when you are ready.");
    } catch (error) {
      setGrokError(error instanceof Error ? error.message : "Grok sign-in failed");
    } finally {
      setGrokBusy(false);
    }
  }

  async function logOutOfGrok() {
    setGrokBusy(true);
    setGrokError(null);
    try {
      const next = await logoutGrokSubscriptionSignIn();
      setGrokSubscription(next.status);
      setConfig(next.config);
      setSecret(next.secret);
      setFastSecret(next.fastSecret);
    } catch (error) {
      setGrokError(error instanceof Error ? error.message : "Could not sign out of Grok");
    } finally {
      setGrokBusy(false);
    }
  }

  return (
    <PageFrame eyebrow="Runtime" title="Inference">
      <ThemeSync ui={ui} />
      <Tabs defaultValue="model">
        <TabsList className="mb-6">
          <TabsTrigger value="model">Models</TabsTrigger>
          <TabsTrigger value="local">Local inference</TabsTrigger>
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
            grokSubscription={grokSubscription}
            grokBusy={grokBusy}
            grokError={grokError}
            localModels={initialState.settings.localModels}
            apiKey={apiKey}
            fastApiKey={fastApiKey}
            setApiKey={setApiKey}
            setFastApiKey={setFastApiKey}
            setPrimaryClearAction={setPrimaryClearAction}
            onGrokSignIn={() => void signInWithGrok()}
            onGrokLogout={() => void logOutOfGrok()}
            saved={saved}
            saveBusy={saveBusy}
            onSave={() => void save()}
          />
        </TabsContent>

        <TabsContent value="local">
          <LocalInferencePanel initialState={initialState.localInference} currentConfig={config} />
        </TabsContent>
      </Tabs>

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectedLocalAgentModel(config: SettingsPageStateDto["config"]): string {
  if (isLocalAiProvider(config.aiProvider)) return config.aiModel;
  if (isLocalAiProvider(config.fastAiProvider)) return config.fastAiModel;
  return config.localAgentModel;
}
