import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import {
  ApiKeyInput,
  Field,
  ModelCombobox,
  ProviderSelect,
} from "@/components/settings-form-bits";
import { ThemeSync } from "@/components/theme-sync";
import { Button } from "@/components/ui/button";
import { saveSettingsWithSetupGateRefresh, setCachedSetupGateState } from "@/lib/setup-gate";
import { saveProfile } from "@/server/profile.functions";
import type { SetupPageStateDto } from "@/server/dto";
import { defaultModelForProvider } from "../../src/agent/ai-providers";

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
  const [apiKey, setApiKey] = useState("");
  const [userName, setUserName] = useState(initialState.profile.userName);
  const [userLocation, setUserLocation] = useState(initialState.profile.userLocation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const needsModel = !initialState.aiConfigured;
  const needsKey = provider !== "ollama";
  const canSubmit =
    !busy
    && userName.trim().length > 0
    && (!needsModel || (model.trim().length > 0 && (!needsKey || apiKey.trim().length > 0)));

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
      if (needsModel) {
        setSaveStatus("Checking model settings...");
        const result = await withSetupTimeout(
          saveSettingsWithSetupGateRefresh({
            data: {
              runtime: { aiProvider: provider, aiModel: model.trim() },
              apiKey: needsKey ? apiKey.trim() : undefined,
            },
          }),
          "Saving AI settings",
        );
        aiConfigured = result.aiConfigured;
        if (!aiConfigured) {
          setError("Saved settings, but Aithy still needs a model and API key.");
          return;
        }
      }
      setCachedSetupGateState({ aiConfigured, profileConfigured: true });
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
    setProvider(nextProvider);
    if (!initialState.config.aiModel) {
      setModel(defaultModelForProvider(nextProvider));
    }
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
              className="h-11 w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 text-sm outline-none transition placeholder:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--foreground))]"
              value={userName}
              onChange={(event) => setUserName(event.target.value)}
              placeholder="What should Aithy call you?"
            />
          </Field>
          <Field label="Location (optional)">
            <input
              className="h-11 w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 text-sm outline-none transition placeholder:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--foreground))]"
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
                <ProviderSelect value={provider} onChange={changeProvider} />
              </Field>
              <Field label="Model">
                <ModelCombobox
                  provider={provider}
                  value={model}
                  onChange={setModel}
                  placeholder="e.g. gpt-4.1"
                />
              </Field>
            </div>
            <Field label={needsKey ? "API key" : "API key (not required)"}>
              <ApiKeyInput
                value={apiKey}
                onChange={setApiKey}
                secret={null}
                disabled={!needsKey}
                fallback={needsKey ? "Stored in the encrypted secrets store" : "Local provider — no key needed"}
              />
            </Field>
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
