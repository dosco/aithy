import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowRight, LogIn, RefreshCw } from "lucide-react";
import { AsciiSplash } from "@/components/ascii-splash";
import { LocalInferenceSplash } from "@/components/local-inference-splash";
import { InferenceProfileInputs } from "@/components/inference-profile-fields";
import { useLiveEvent } from "@/components/live-events";
import {
  ApiKeyInput,
  Field,
  ModelCombobox,
  ProviderSelect,
  fieldClass,
} from "@/components/settings-form-bits";
import { ThemeSync } from "@/components/theme-sync";
import { Button } from "@/components/ui/button";
import { saveSettingsWithSetupGateRefresh, setCachedSetupGateState } from "@/lib/setup-gate";
import {
  pollGrokSubscriptionSignIn,
  startGrokSubscriptionSignIn,
} from "@/server/actions.functions";
import { saveProfile } from "@/server/profile.functions";
import { getSetupGateState } from "@/server/state.functions";
import type { GrokSubscriptionStatusDto, SetupPageStateDto } from "@/server/dto";
import {
  capabilitiesForProviderModel,
  defaultModelForProvider,
  isXaiGrokSubscriptionProvider,
  missingProfileConfiguration,
  normalizeServiceTierForSelection,
  normalizeThinkingLevelForSelection,
  providerAuthentication,
  providerUsesApiUrl,
  type AiServiceTier,
  type AiThinkingLevel,
} from "../../src/agent/ai-providers";

const SETUP_SAVE_TIMEOUT_MS = 45_000;

const ASCII_LOGO = `      ..:::::..
   .:+#########+:.
  :###=:....:=###:
 .##+  AITHY   +##.
 .##+  //////  +##.
  :###=::::=###:
   .:+#####:+.
      ':::'`;

export function SetupPage({
  initialState,
}: {
  initialState: SetupPageStateDto;
}) {
  const router = useRouter();
  const initialProvider = initialState.config.aiProvider || "openai";
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(
    initialState.config.aiModel || defaultModelForProvider(initialProvider),
  );
  const [apiUrl, setApiUrl] = useState(initialState.config.aiApiUrl);
  const [profileArgs, setProfileArgs] = useState(initialState.config.aiProfileArgs);
  const [thinkingLevel, setThinkingLevel] = useState<AiThinkingLevel | "">(
    initialState.config.aiThinkingLevel,
  );
  const [serviceTier, setServiceTier] = useState<AiServiceTier>(initialState.config.aiServiceTier);
  const [apiKey, setApiKey] = useState("");
  const [userName, setUserName] = useState(initialState.profile.userName);
  const [userLocation, setUserLocation] = useState(initialState.profile.userLocation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [setupStatuses, setSetupStatuses] = useState(initialState.setupStatuses);
  const [setupGate, setSetupGate] = useState(initialState.setupGate);
  const [grokSubscription, setGrokSubscription] = useState<GrokSubscriptionStatusDto>(
    initialState.grokSubscription,
  );
  const [grokBusy, setGrokBusy] = useState(false);

  const needsModel = !initialState.aiConfigured;
  const needsGrokSignIn = isXaiGrokSubscriptionProvider(provider);
  const authentication = providerAuthentication(provider);
  const needsKey = authentication === "required";
  const needsApiUrl = providerUsesApiUrl(provider);
  const localOnly = setupGate.localInferenceRequired && !setupGate.localInferenceReady;
  const profileConfigurationComplete = missingProfileConfiguration(provider, apiUrl, profileArgs).length === 0;
  const canSubmit =
    !busy
    && userName.trim().length > 0
    && (!needsModel || (
      model.trim().length > 0
      && profileConfigurationComplete
      && (!needsKey || apiKey.trim().length > 0)
      && (!needsGrokSignIn || grokSubscription.connected)
    ));

  async function startChatting() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setSaveStatus("Saving profile...");
    try {
      await withSetupTimeout(
        saveProfile({
          data: {
            userName: userName.trim(),
            userLocation: userLocation.trim(),
          },
        }),
        "Saving profile",
      );
      let aiConfigured = initialState.aiConfigured;
      let nextSetupGate = setupGate;
      if (needsModel) {
        setSaveStatus("Checking model settings...");
        const result = await withSetupTimeout(
          saveSettingsWithSetupGateRefresh({
            data: {
              runtime: {
                aiProvider: provider,
                aiApiUrl: needsApiUrl ? apiUrl.trim() : null,
                aiModel: model.trim(),
                aiProfileArgs: profileArgs,
                aiThinkingLevel: thinkingLevel || null,
                aiServiceTier: capabilitiesForSave(provider, model, serviceTier),
                localAgentModel: model.trim(),
              },
              apiKey: authentication !== "none" && apiKey.trim() ? apiKey.trim() : undefined,
            },
          }),
          "Saving AI settings",
        );
        aiConfigured = result.aiConfigured;
        nextSetupGate = { ...result.setupGate, profileConfigured: true };
        if (!aiConfigured) {
          setError("Saved profile, but Aithy still needs complete model settings.");
          return;
        }
      }
      setSetupGate(nextSetupGate);
      setCachedSetupGateState({ ...nextSetupGate, aiConfigured, profileConfigured: true });
      setSaveStatus("Opening chat...");
      await withSetupTimeout(
        router.navigate({ href: "/chat", replace: true }),
        "Opening chat",
        15_000,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setBusy(false);
      setSaveStatus(null);
    }
  }

  function changeProvider(nextProvider: string) {
    const savedProfile = initialState.settings.runtime.aiProviderProfiles?.[nextProvider];
    const nextModel = savedProfile?.model ?? defaultModelForProvider(nextProvider);
    setProvider(nextProvider);
    setModel(nextModel ?? "");
    setApiUrl(savedProfile?.apiUrl ?? "");
    setProfileArgs(savedProfile?.profileArgs ?? {});
    setThinkingLevel(normalizeThinkingLevelForSelection(nextProvider, nextModel, savedProfile?.thinkingLevel) ?? "");
    setServiceTier(normalizeServiceTierForSelection(nextProvider, nextModel, savedProfile?.serviceTier) ?? "auto");
  }

  function changeModel(nextModel: string) {
    setModel(nextModel);
    setThinkingLevel((current) => normalizeThinkingLevelForSelection(provider, nextModel, current) ?? "");
    setServiceTier((current) => normalizeServiceTierForSelection(provider, nextModel, current) ?? "auto");
  }

  async function signInWithGrok() {
    setGrokBusy(true);
    setError(null);
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
        if (next.state !== "signing_in") {
          if (next.state !== "connected") setError(next.message);
          return;
        }
      }
      setError("Grok sign-in is still waiting. Retry when you are ready.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Grok sign-in failed");
    } finally {
      setGrokBusy(false);
    }
  }

  useLiveEvent((event) => {
    if (event.type !== "setup-status" || !event.key.startsWith("local.")) return;
    setSetupStatuses((current) => {
      const next = current.filter((status) => status.key !== event.key);
      if (event.active || event.tone === "danger") next.unshift(event);
      return next;
    });
  });

  useEffect(() => {
    if (!localOnly) return;
    let cancelled = false;
    const timer = setInterval(() => {
      void getSetupGateState().then((state) => {
        if (cancelled) return;
        setSetupGate(state);
        if (state.localInferenceRequired && !state.localInferenceReady) return;
        setCachedSetupGateState(state);
        if (state.aiConfigured && state.profileConfigured) {
          void router.navigate({ href: "/chat", replace: true });
        }
      });
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [localOnly, router]);

  if (localOnly) {
    return (
      <>
        <ThemeSync ui={initialState.settings.ui} />
        <LocalInferenceSplash statuses={setupStatuses} />
      </>
    );
  }

  return (
    <section className="app-page-frame mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 py-20">
      <ThemeSync ui={initialState.settings.ui} />
      <pre
        aria-hidden="true"
        className="mb-8 select-none whitespace-pre text-center font-mono text-sm leading-tight text-[rgb(var(--muted-foreground))]"
      >
        {ASCII_LOGO}
      </pre>
      <h1 className="mb-2 text-3xl font-normal tracking-tight sm:text-4xl">
        Welcome to Aithy
      </h1>
      <p className="mb-10 text-center text-sm text-[rgb(var(--muted-foreground))]">
        One-time setup. Tell Aithy who it is helping, then connect a model.
        Public web search already works anonymously through Parallel; add a key
        later in Settings for higher limits.
      </p>

      <div className="grid w-full gap-4 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/40 p-6">
        <div className="grid gap-4">
          <Field label="Your name">
            <input
              className={fieldClass}
              value={userName}
              onChange={(event) => setUserName(event.target.value)}
              placeholder="What should Aithy call you?"
            />
          </Field>
          <Field label="Location (optional)">
            <input
              className={fieldClass}
              value={userLocation}
              onChange={(event) => setUserLocation(event.target.value)}
              placeholder="City, region, or timezone"
            />
          </Field>
          {/*
          Profile image UI intentionally hidden until launch.
            <ProfilePhotoInput
              label="Your photo"
              image={userPhoto}
              fallback={initials(userName, "You")}
              onUpload={(payload) => {
                setPendingUserPhoto(payload);
                setUserPhoto(previewImage(payload));
              }}
            />
          */}
        </div>

        {needsModel ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Provider">
                <ProviderSelect
                  value={provider}
                  onChange={changeProvider}
                  providerSecrets={initialState.providerSecrets}
                />
              </Field>
              <Field label="Model">
                <ModelCombobox
                  provider={provider}
                  value={model}
                  onChange={changeModel}
                  placeholder="e.g. gpt-4.1"
                />
              </Field>
              <InferenceProfileInputs
                provider={provider}
                model={model}
                apiUrl={apiUrl}
                profileArgs={profileArgs}
                thinkingLevel={thinkingLevel}
                serviceTier={serviceTier}
                onApiUrlChange={setApiUrl}
                onProfileArgChange={(name, value) => setProfileArgs((current) => ({ ...current, [name]: value }))}
                onThinkingLevelChange={(value) => setThinkingLevel(value as AiThinkingLevel | "")}
                onServiceTierChange={(value) => setServiceTier(value as AiServiceTier)}
              />
            </div>
            {needsGrokSignIn ? (
              <div className="grid gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">
                      {grokSubscription.connected ? "Grok subscription connected" : "Sign in with Grok"}
                    </p>
                    <p className="text-xs text-[rgb(var(--muted-foreground))]">
                      Requires SuperGrok or X Premium+. No API key required.
                    </p>
                  </div>
                  <Button type="button" size="sm" disabled={grokBusy} onClick={() => void signInWithGrok()}>
                    {grokSubscription.state === "error" || grokSubscription.state === "needs_reauth" ? (
                      <RefreshCw className="h-4 w-4" />
                    ) : (
                      <LogIn className="h-4 w-4" />
                    )}
                    {grokBusy ? "Opening..." : grokSubscription.connected ? "Retry" : "Sign in"}
                  </Button>
                </div>
                {grokSubscription.message ? (
                  <p className="text-xs text-[rgb(var(--muted-foreground))]">{grokSubscription.message}</p>
                ) : null}
              </div>
            ) : (
              <Field label={needsKey
                ? "API key"
                : authentication === "optional" ? "API key (optional)" : "API key (not required)"}>
                <ApiKeyInput
                  value={apiKey}
                  onChange={setApiKey}
                  secret={null}
                  disabled={authentication === "none"}
                  fallback={needsKey
                    ? "Stored in the encrypted secrets store"
                    : authentication === "optional" ? "Optional bearer token" : "No API key needed"}
                />
              </Field>
            )}
          </>
        ) : null}

        {error ? (
          <p className="text-sm text-red-500" role="alert">
            {error}
          </p>
        ) : null}

        {busy && saveStatus ? (
          <p className="text-sm text-[rgb(var(--muted-foreground))]" role="status" aria-live="polite">
            {saveStatus}
          </p>
        ) : null}

        <div className="flex justify-end pt-1">
          <Button onClick={() => void startChatting()} disabled={!canSubmit}>
            {busy ? "Saving…" : "Start chatting"}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-[rgb(var(--muted-foreground))]">
        You can change any of this later in <strong>Settings</strong>.
      </p>
    </section>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function initials(value: string, fallback: string): string {
  const letters = value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  return letters || fallback;
}

async function withSetupTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = SETUP_SAVE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out. Open Console to see service and provider logs.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function capabilitiesForSave(
  provider: string,
  model: string,
  tier: AiServiceTier,
): AiServiceTier | undefined {
  return capabilitiesForProviderModel(provider, model).serviceTiers.length > 0 ? tier : undefined;
}
