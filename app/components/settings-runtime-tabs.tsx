import type { Dispatch, SetStateAction } from "react";
import { Check, LogIn, LogOut, RefreshCw, UserCircle } from "lucide-react";
import type { PrimaryClearAction } from "@/components/settings-page-helpers";
import { saveButtonLabel } from "@/components/settings-page-helpers";
import {
  ApiKeyInput,
  Field,
  ModelCombobox,
  type ModelOption,
  ProviderSelect,
  Section,
  fieldClass,
  selectClass,
} from "@/components/settings-form-bits";
import { GlobalMountsSection } from "@/components/settings-global-mounts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ConfigDto, GrokSubscriptionStatusDto, LocalModelDto, SecretStatusDto } from "@/server/dto";
import {
  defaultModelForProvider,
  isCustomOpenAIProvider,
  isLocalAiProvider,
  isXaiGrokSubscriptionProvider,
} from "../../src/agent/ai-providers";
import { providerRequiresApiKey } from "../../src/config/validate";

interface RuntimeTabProps {
  config: ConfigDto;
  setConfig: Dispatch<SetStateAction<ConfigDto>>;
  saved: boolean;
  saveBusy: boolean;
  onSave: () => void;
}

interface ModelTabProps extends RuntimeTabProps {
  secret: SecretStatusDto;
  fastSecret: SecretStatusDto | null;
  grokSubscription: GrokSubscriptionStatusDto;
  grokBusy: boolean;
  grokError: string | null;
  localModels: LocalModelDto[];
  apiKey: string;
  fastApiKey: string;
  setApiKey: (value: string) => void;
  setFastApiKey: (value: string) => void;
  setPrimaryClearAction: (action: PrimaryClearAction) => void;
  onGrokSignIn: () => void;
  onGrokLogout: () => void;
}

interface SandboxTabProps extends RuntimeTabProps {
  skippedPaths: string[];
}

export function ModelSettingsTab(props: ModelTabProps) {
  const { config, setConfig, secret, fastSecret, apiKey, fastApiKey } = props;
  const localModelOptions = props.localModels
    .filter((model) => !model.role || model.role === "chat")
    .map(localModelOption);
  const localModelValues = localModelOptions.map((model) => model.value);
  const primaryIsGrok = isXaiGrokSubscriptionProvider(config.aiProvider);
  const fastIsGrok = isXaiGrokSubscriptionProvider(config.fastAiProvider);
  const primaryNeedsKey = providerRequiresApiKey(config.aiProvider);
  const changePrimaryProvider = (value: string) => {
    setConfig((current) => {
      const aiModel = nextModelValue(value, current.aiProvider, current.aiModel, current.localAgentModel, localModelValues);
      return {
        ...current,
        aiProvider: value,
        aiModel,
        localAgentModel: isLocalAiProvider(value) ? aiModel : current.localAgentModel,
      };
    });
  };
  const changeFastProvider = (value: string) => {
    setConfig((current) => {
      const fastAiModel = value
        ? nextModelValue(value, current.fastAiProvider, current.fastAiModel, current.localAgentModel, localModelValues)
        : "";
      return {
        ...current,
        fastAiProvider: value,
        fastAiModel,
        localAgentModel: isLocalAiProvider(value) ? fastAiModel : current.localAgentModel,
      };
    });
  };
  const changePrimaryModel = (value: string) => {
    setConfig((current) => ({
      ...current,
      aiModel: value,
      localAgentModel: isLocalAiProvider(current.aiProvider) ? value : current.localAgentModel,
    }));
  };
  const changeFastModel = (value: string) => {
    setConfig((current) => ({
      ...current,
      fastAiModel: value,
      localAgentModel: isLocalAiProvider(current.fastAiProvider) ? value : current.localAgentModel,
    }));
  };
  return (
    <div className="grid gap-5">
      <Section title="Primary" subtitle="Drives the executor, context, and final responder by default.">
        {primaryIsGrok ? (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--muted))]/30 px-3.5 py-2 text-sm text-[rgb(var(--muted-foreground))]">
            Use Grok with a SuperGrok or X Premium+ subscription. No API key required.
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <ProviderSelect value={config.aiProvider} onChange={changePrimaryProvider} />
          </Field>
          <Field label="Model">
            <ModelCombobox
              provider={config.aiProvider}
              value={config.aiModel}
              modelOptions={isLocalAiProvider(config.aiProvider) ? localModelOptions : undefined}
              onChange={changePrimaryModel}
              onClear={() => props.setPrimaryClearAction("model")}
            />
          </Field>
          {isCustomOpenAIProvider(config.aiProvider) ? (
            <div className="sm:col-span-2">
              <Field label="Base URL">
                <input
                  className={fieldClass}
                  value={config.aiApiUrl}
                  onChange={(event) => setConfigValue(setConfig, "aiApiUrl", event.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </Field>
            </div>
          ) : null}
        </div>
        {primaryIsGrok ? (
          <GrokSubscriptionCard
            status={props.grokSubscription}
            busy={props.grokBusy}
            error={props.grokError}
            onSignIn={props.onGrokSignIn}
            onLogout={props.onGrokLogout}
          />
        ) : (
          <Field label={primaryNeedsKey ? "API key" : "API key (not required)"}>
            <ApiKeyInput
              value={apiKey}
              onChange={props.setApiKey}
              secret={secret}
              disabled={!primaryNeedsKey}
              fallback={primaryNeedsKey ? "Stored in the encrypted secrets store" : "Local provider - no key needed"}
              onClear={() => props.setPrimaryClearAction("key")}
            />
          </Field>
        )}
      </Section>

      <Section title="Fast model" subtitle="Optional. Used for responder + recursion calls; falls back to primary when empty." muted>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <ProviderSelect
              value={config.fastAiProvider}
              allowEmpty
              onChange={changeFastProvider}
            />
          </Field>
          <Field label="Model">
            <ModelCombobox
              provider={config.fastAiProvider}
              value={config.fastAiModel}
              modelOptions={isLocalAiProvider(config.fastAiProvider) ? localModelOptions : undefined}
              disabled={!config.fastAiProvider}
              placeholder={config.fastAiProvider ? "e.g. gpt-4o-mini" : "set provider first"}
              onChange={changeFastModel}
            />
          </Field>
          {isCustomOpenAIProvider(config.fastAiProvider) ? (
            <div className="sm:col-span-2">
              <Field label="Base URL">
                <input
                  className={fieldClass}
                  value={config.fastAiApiUrl}
                  onChange={(event) => setConfigValue(setConfig, "fastAiApiUrl", event.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </Field>
            </div>
          ) : null}
        </div>
        {fastIsGrok ? (
          <GrokSubscriptionCard
            compact
            status={props.grokSubscription}
            busy={props.grokBusy}
            error={props.grokError}
            onSignIn={props.onGrokSignIn}
            onLogout={props.onGrokLogout}
          />
        ) : (
          <Field label="API key">
            <ApiKeyInput
              value={fastApiKey}
              onChange={props.setFastApiKey}
              secret={fastSecret}
              disabled={!config.fastAiProvider || !providerRequiresApiKey(config.fastAiProvider)}
              fallback={fastApiKeyFallback(config, secret)}
            />
          </Field>
        )}
      </Section>

      <SaveRow saved={props.saved} saveBusy={props.saveBusy} onSave={props.onSave} />
    </div>
  );
}

function GrokSubscriptionCard({
  status,
  busy,
  error,
  compact = false,
  onSignIn,
  onLogout,
}: {
  status: GrokSubscriptionStatusDto;
  busy: boolean;
  error: string | null;
  compact?: boolean;
  onSignIn: () => void;
  onLogout: () => void;
}) {
  const connected = status.connected;
  const needsRetry = status.state === "needs_reauth" || status.state === "error" || status.state === "tier_denied";
  return (
    <div className="grid gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <UserCircle className="mt-0.5 h-5 w-5 shrink-0 text-[rgb(var(--muted-foreground))]" />
          <div className="grid gap-1">
            <p className="text-sm font-medium">{connected ? "Grok subscription connected" : "Sign in with Grok"}</p>
            <p className="text-xs leading-5 text-[rgb(var(--muted-foreground))]">
              {statusCopy(status, compact)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={onSignIn}>
            {needsRetry ? <RefreshCw className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
            {connected ? "Retry" : needsRetry ? "Retry" : busy ? "Opening..." : "Sign in"}
          </Button>
          {connected || status.state === "tier_denied" ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onLogout}>
              <LogOut className="h-4 w-4" />
              Log out
            </Button>
          ) : null}
        </div>
      </div>
      {error || status.message ? (
        <p className="text-xs leading-5 text-[rgb(var(--muted-foreground))]">
          {error ?? status.message}
        </p>
      ) : null}
    </div>
  );
}

function statusCopy(status: GrokSubscriptionStatusDto, compact: boolean): string {
  if (status.connected) {
    return compact
      ? "Fast model calls use the connected Grok subscription."
      : "Chat and web.search can use the connected Grok subscription.";
  }
  if (status.state === "signing_in") return "Complete the Grok sign-in in your browser.";
  if (status.state === "tier_denied") {
    return "This subscription is connected, but xAI API access is not enabled for the current tier.";
  }
  return "Requires SuperGrok or X Premium+.";
}

export function SandboxSettingsTab({ config, setConfig, skippedPaths, saved, saveBusy, onSave }: SandboxTabProps) {
  return (
    <div className="grid gap-5">
      <Section title="Sandbox" subtitle="Where tool calls execute. Disabled mode runs local Bun Shell commands without isolation.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <select
              value={config.sandboxProvider}
              onChange={(event) => setConfigValue(setConfig, "sandboxProvider", event.target.value)}
              className={selectClass}
            >
              <option value="microsandbox">microsandbox</option>
              <option value="disabled">disabled</option>
            </select>
          </Field>
          {config.sandboxProvider === "microsandbox" ? (
            <MicrosandboxFields config={config} setConfig={setConfig} />
          ) : (
            <Field label="Execution"><input className={fieldClass} value="Local host via Bun Shell" readOnly /></Field>
          )}
        </div>
      </Section>
      <RuntimeFields config={config} setConfig={setConfig} />
      {config.sandboxProvider === "microsandbox" ? (
        <GlobalMountsSection
          mounts={config.globalMounts}
          skippedPaths={skippedPaths}
          onChange={(next) => setConfigValue(setConfig, "globalMounts", next)}
        />
      ) : null}
      <SaveRow saved={saved} saveBusy={saveBusy} onSave={onSave} />
    </div>
  );
}

function MicrosandboxFields({ config, setConfig }: Pick<RuntimeTabProps, "config" | "setConfig">) {
  return (
    <>
      <Field label="Image">
        <input className={fieldClass} value={config.sandboxImage} onChange={(event) => setConfigValue(setConfig, "sandboxImage", event.target.value)} />
      </Field>
      <Field label="Network">
        <select value={config.sandboxNetwork} onChange={(event) => setConfigValue(setConfig, "sandboxNetwork", event.target.value)} className={selectClass}>
          <option value="none">none</option>
          <option value="public">public</option>
          <option value="allow-all">allow-all</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="CPUs">
          <input className={fieldClass} type="number" value={config.sandboxCpus} onChange={(event) => setConfigValue(setConfig, "sandboxCpus", Number(event.target.value))} />
        </Field>
        <Field label="Memory (MB)">
          <input className={fieldClass} type="number" value={config.sandboxMemoryMb} onChange={(event) => setConfigValue(setConfig, "sandboxMemoryMb", Number(event.target.value))} />
        </Field>
      </div>
    </>
  );
}

function RuntimeFields({ config, setConfig }: Pick<RuntimeTabProps, "config" | "setConfig">) {
  return (
    <Section title="Javascript Runtime" subtitle="Session lifecycle and tracing.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Host shell">
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5">
            <span className="text-sm text-[rgb(var(--muted-foreground))]">
              {config.systemBashEnabled ? "system.bash available with approval" : "system.bash disabled"}
            </span>
            <Switch
              checked={config.systemBashEnabled}
              onCheckedChange={(value) => setConfigValue(setConfig, "systemBashEnabled", value)}
            />
          </div>
        </Field>
        <Field label="Session TTL (ms)">
          <input className={fieldClass} type="number" value={config.sessionTtlMs} onChange={(event) => setConfigValue(setConfig, "sessionTtlMs", Number(event.target.value))} />
        </Field>
        <Field label="Tracing">
          <div className="flex h-11 items-center gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5">
            <Switch checked={config.traceEnabled} onCheckedChange={(value) => setConfigValue(setConfig, "traceEnabled", value)} />
            <span className="text-sm text-[rgb(var(--muted-foreground))]">{config.traceEnabled ? "Enabled" : "Disabled"}</span>
          </div>
        </Field>
        <Field label={`Parallel agents (${config.parallelAgents})`}>
          <div className="flex h-11 items-center gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5">
            <input type="range" min={1} max={8} step={1} value={config.parallelAgents} onChange={(event) => setConfigValue(setConfig, "parallelAgents", Number(event.target.value))} className="flex-1" aria-label="Parallel agents" />
            <span className="w-6 text-right tabular-nums text-sm text-[rgb(var(--muted-foreground))]">{config.parallelAgents}</span>
          </div>
        </Field>
      </div>
    </Section>
  );
}

function SaveRow({ saved, saveBusy, onSave }: { saved: boolean; saveBusy: boolean; onSave: () => void }) {
  return (
    <div className="flex justify-end pt-1">
      <Button onClick={onSave} disabled={saveBusy} className="sm:min-w-[140px]">
        {saved ? <Check className="h-4 w-4" /> : null}
        {saveButtonLabel(saveBusy, saved)}
      </Button>
    </div>
  );
}

function fastApiKeyFallback(config: ConfigDto, secret: SecretStatusDto): string {
  if (!config.fastAiProvider) return "Set provider first";
  if (!providerRequiresApiKey(config.fastAiProvider)) return "Local provider - no key needed";
  if (config.fastAiProvider !== config.aiProvider) return "Stored in the encrypted secrets store";
  return secret.configured ? "Reuses primary key" : "Set primary key first";
}

function localModelOption(model: LocalModelDto): ModelOption {
  return {
    value: model.id,
    label: model.displayName,
    detail: model.cached ? "cached" : model.managed ? "download needed" : model.filename,
  };
}

function nextModelValue(
  nextProvider: string,
  currentProvider: string,
  currentModel: string,
  localAgentModel: string,
  localModelOptions: string[],
): string {
  if (isLocalAiProvider(nextProvider)) {
    return localAgentModel || localModelOptions[0] || defaultModelForProvider(nextProvider);
  }
  if (!currentModel || isLocalAiProvider(currentProvider)) {
    return defaultModelForProvider(nextProvider);
  }
  return currentModel;
}

function setConfigValue<K extends keyof ConfigDto>(
  setter: Dispatch<SetStateAction<ConfigDto>>,
  key: K,
  value: ConfigDto[K],
) {
  setter((current) => ({ ...current, [key]: value }));
}
