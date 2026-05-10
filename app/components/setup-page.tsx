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
import { saveSettings } from "@/server/actions.functions";
import type { WebStateDto } from "@/server/dto";

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
  redirectTo,
}: {
  initialState: WebStateDto;
  redirectTo: string;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState(
    initialState.config.aiProvider || "openai",
  );
  const [model, setModel] = useState(initialState.config.aiModel || "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsKey = provider !== "ollama";
  const canSubmit =
    !busy && model.trim().length > 0 && (!needsKey || apiKey.trim().length > 0);

  async function startChatting() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveSettings({
        data: {
          runtime: { aiProvider: provider, aiModel: model.trim() },
          apiKey: needsKey ? apiKey.trim() : undefined,
        },
      });
      if (!result.aiConfigured) {
        setError("Saved settings, but Aithy still needs a model and API key.");
        return;
      }
      await router.navigate({ href: redirectTo, replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setBusy(false);
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
        One-time setup. Pick a model, drop in a key, and we&apos;re off.
      </p>

      <div className="grid w-full gap-4 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/40 p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <ProviderSelect value={provider} onChange={setProvider} />
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
            fallback={
              needsKey
                ? "Stored with Bun.secrets when saved"
                : "Local provider — no key needed"
            }
          />
        </Field>

        {error ? (
          <p className="text-sm text-red-500" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-[rgb(var(--muted-foreground))]">
            State lives at{" "}
            <code>~/.config/aithy/{initialState.config.botId}/</code>. Keys go
            to <code>Bun.secrets</code>.
          </p>
          <Button onClick={() => void startChatting()} disabled={!canSubmit}>
            {busy ? "Testing…" : "Start chatting"}
            <ArrowRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-[rgb(var(--muted-foreground))]">
        You can change any of this later in <strong>Settings → Model</strong>.
      </p>
    </section>
  );
}
