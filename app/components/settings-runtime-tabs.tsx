import type { Dispatch, SetStateAction } from "react";
import { LogIn, LogOut, RefreshCw, UserCircle } from "lucide-react";
import { FamilyInferenceSelector } from "@/components/family-mesh-selectors";
import type { PrimaryClearAction } from "@/components/settings-page-helpers";
import { SettingsSaveBar } from "@/components/settings-save-bar";
import { InferenceProfileFields } from "@/components/inference-profile-fields";
import {
  ApiKeyInput,
  Field,
  ModelCombobox,
  type ModelOption,
  ProviderSelect,
  Section,
  selectClass,
} from "@/components/settings-form-bits";
import { Button } from "@/components/ui/button";
import type {
  ConfigDto,
  GrokSubscriptionStatusDto,
  LocalModelDto,
  MeshLiveCatalogPeerDto,
  SecretStatusDto,
} from "@/server/dto";
import {
  defaultModelForProvider,
  isLocalAiProvider,
  isXaiGrokSubscriptionProvider,
  normalizeServiceTierForSelection,
  normalizeThinkingLevelForSelection,
  providerAuthentication,
} from "../../src/agent/ai-providers";
import { isMeshInferenceProvider } from "../../src/mesh/types";

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
  providerSecrets: Record<string, SecretStatusDto>;
  grokSubscription: GrokSubscriptionStatusDto;
  grokBusy: boolean;
  grokError: string | null;
  localModels: LocalModelDto[];
  meshCatalogs: MeshLiveCatalogPeerDto[];
  onRefreshMeshCatalogs?: () => void;
  apiKey: string;
  fastApiKey: string;
  setApiKey: (value: string) => void;
  setFastApiKey: (value: string) => void;
  setPrimaryClearAction: (action: PrimaryClearAction) => void;
  onGrokSignIn: () => void;
  onGrokLogout: () => void;
}

export function ModelSettingsTab(props: ModelTabProps) {
  const { config, setConfig, secret, fastSecret, apiKey, fastApiKey } = props;
  const localModelOptions = props.localModels
    .filter((model) => !model.role || model.role === "chat")
    .map(localModelOption);
  const localModelValues = localModelOptions.map((model) => model.value);
  const primaryFamily = isMeshInferenceProvider(config.aiProvider);
  const fastFamily = isMeshInferenceProvider(config.fastAiProvider);
  const primaryIsGrok = isXaiGrokSubscriptionProvider(config.aiProvider);
  const fastIsGrok = isXaiGrokSubscriptionProvider(config.fastAiProvider);
  const primaryAuth = providerAuthentication(config.aiProvider);
  const fastAuth = providerAuthentication(config.fastAiProvider);
  const changePrimaryProvider = (value: string) => {
    setConfig((current) => {
      const profile = current.aiProviderProfiles?.[value];
      const aiModel = profile?.model ?? nextModelValue(value, current.aiProvider, current.aiModel, current.localAgentModel, localModelValues);
      return {
        ...current,
        aiProvider: value,
        aiApiUrl: profile?.apiUrl ?? "",
        aiModel,
        aiProfileArgs: profile?.profileArgs ?? {},
        aiThinkingLevel: normalizeThinkingLevelForSelection(value, aiModel, profile?.thinkingLevel) ?? "",
        aiServiceTier: normalizeServiceTierForSelection(value, aiModel, profile?.serviceTier) ?? "auto",
        localAgentModel: isLocalAiProvider(value) ? aiModel : current.localAgentModel,
      };
    });
  };
  const changeFastProvider = (value: string) => {
    setConfig((current) => {
      const profile = value ? current.aiProviderProfiles?.[value] : undefined;
      const fastAiModel = value
        ? profile?.fastModel ?? nextModelValue(value, current.fastAiProvider, current.fastAiModel, current.localAgentModel, localModelValues)
        : "";
      return {
        ...current,
        fastAiProvider: value,
        fastAiApiUrl: profile?.fastApiUrl ?? profile?.apiUrl ?? "",
        fastAiModel,
        fastAiProfileArgs: profile?.fastProfileArgs ?? profile?.profileArgs ?? {},
        fastAiThinkingLevel: normalizeThinkingLevelForSelection(value, fastAiModel, profile?.fastThinkingLevel) ?? "",
        fastAiServiceTier: normalizeServiceTierForSelection(value, fastAiModel, profile?.fastServiceTier) ?? "auto",
        localAgentModel: isLocalAiProvider(value) ? fastAiModel : current.localAgentModel,
      };
    });
  };
  const changePrimaryModel = (value: string) => {
    setConfig((current) => ({
      ...current,
      aiModel: value,
      aiThinkingLevel: normalizeThinkingLevelForSelection(current.aiProvider, value, current.aiThinkingLevel) ?? "",
      aiServiceTier: normalizeServiceTierForSelection(current.aiProvider, value, current.aiServiceTier) ?? "auto",
      localAgentModel: isLocalAiProvider(current.aiProvider) ? value : current.localAgentModel,
    }));
  };
  const changeFastModel = (value: string) => {
    setConfig((current) => ({
      ...current,
      fastAiModel: value,
      fastAiThinkingLevel: normalizeThinkingLevelForSelection(current.fastAiProvider, value, current.fastAiThinkingLevel) ?? "",
      fastAiServiceTier: normalizeServiceTierForSelection(current.fastAiProvider, value, current.fastAiServiceTier) ?? "auto",
      localAgentModel: isLocalAiProvider(current.fastAiProvider) ? value : current.localAgentModel,
    }));
  };
  return (
    <div className="grid gap-5">
      <SettingsSaveBar saved={props.saved} saveBusy={props.saveBusy} onSave={props.onSave} />
      <Section title="Primary" subtitle="Drives the executor, context, and final responder by default.">
        {primaryIsGrok ? (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--muted))]/30 px-3.5 py-2 text-sm text-[rgb(var(--muted-foreground))]">
            Use Grok with a SuperGrok or X Premium+ subscription. No API key required.
          </div>
        ) : null}
        <ValidationBadge validation={secret.validation} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Source">
            <select className={selectClass} value={primaryFamily ? "family" : "local"} onChange={(event) => {
              if (event.target.value === "family") selectFirstFamilyInference(props.meshCatalogs, setConfig, "primary");
              else changePrimaryProvider("openai");
            }}>
              <option value="local">This Aithy</option>
              <option value="family">Family Aithy</option>
            </select>
          </Field>
          {primaryFamily ? null : (
          <Field label="Provider">
            <ProviderSelect
              value={config.aiProvider}
              onChange={changePrimaryProvider}
              providerSecrets={props.providerSecrets}
            />
          </Field>
          )}
        </div>
        {primaryFamily ? (
          <FamilyInferenceSelector
            catalogs={props.meshCatalogs}
            config={config}
            setConfig={setConfig}
            purpose="primary"
            onRefresh={props.onRefreshMeshCatalogs}
          />
        ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model">
            <ModelCombobox
              provider={config.aiProvider}
              value={config.aiModel}
              modelOptions={modelOptionsForProvider(config.aiProvider, localModelOptions)}
              onChange={changePrimaryModel}
              onClear={() => props.setPrimaryClearAction("model")}
            />
          </Field>
          <InferenceProfileFields config={config} setConfig={setConfig} purpose="primary" />
        </div>
        )}
        {primaryIsGrok ? (
          <GrokSubscriptionCard
            status={props.grokSubscription}
            busy={props.grokBusy}
            error={props.grokError}
            onSignIn={props.onGrokSignIn}
            onLogout={props.onGrokLogout}
          />
        ) : (
          <Field label={primaryAuth === "required"
            ? "API key"
            : primaryAuth === "optional" ? "API key (optional)" : "API key (not required)"}>
            <ApiKeyInput
              value={apiKey}
              onChange={props.setApiKey}
              secret={secret}
              disabled={primaryAuth === "none"}
              fallback={primaryAuth === "required"
                ? "Stored in the encrypted secrets store"
                : primaryAuth === "optional" ? "Optional bearer token" : "No API key needed"}
              onClear={() => props.setPrimaryClearAction("key")}
            />
          </Field>
        )}
      </Section>

      <Section title="Fast model" subtitle="Optional. Used for responder + recursion calls; falls back to primary when empty." muted>
        <ValidationBadge validation={fastSecret?.validation} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Source">
            <select className={selectClass} value={!config.fastAiProvider ? "none" : fastFamily ? "family" : "local"} onChange={(event) => {
              if (event.target.value === "none") changeFastProvider("");
              else if (event.target.value === "family") selectFirstFamilyInference(props.meshCatalogs, setConfig, "fast");
              else changeFastProvider("openai");
            }}>
              <option value="none">None</option>
              <option value="local">This Aithy</option>
              <option value="family">Family Aithy</option>
            </select>
          </Field>
          {fastFamily ? null : (
          <Field label="Provider">
            <ProviderSelect
              value={config.fastAiProvider}
              allowEmpty
              onChange={changeFastProvider}
              providerSecrets={props.providerSecrets}
            />
          </Field>
          )}
        </div>
        {fastFamily ? (
          <FamilyInferenceSelector
            catalogs={props.meshCatalogs}
            config={config}
            setConfig={setConfig}
            purpose="fast"
            onRefresh={props.onRefreshMeshCatalogs}
          />
        ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model">
            <ModelCombobox
              provider={config.fastAiProvider}
              value={config.fastAiModel}
              modelOptions={modelOptionsForProvider(config.fastAiProvider, localModelOptions)}
              disabled={!config.fastAiProvider}
              placeholder={config.fastAiProvider ? "e.g. gpt-4o-mini" : "set provider first"}
              onChange={changeFastModel}
            />
          </Field>
          <InferenceProfileFields config={config} setConfig={setConfig} purpose="fast" />
        </div>
        )}
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
              disabled={!config.fastAiProvider || fastAuth === "none"}
              fallback={fastApiKeyFallback(config, secret)}
            />
          </Field>
        )}
      </Section>
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

function ValidationBadge({
  validation,
}: {
  validation?: NonNullable<ConfigDto["aiProviderProfiles"]>[string]["validation"];
}) {
  if (!validation) return null;
  if (validation.status === "valid") return null;
  const label = validation.status === "not-required"
      ? "Validation not required"
      : validation.status === "invalid"
        ? "Validation failed"
        : "Needs validation";
  return (
    <div className="flex">
      <span className="rounded-full border border-[rgb(var(--border))] px-2.5 py-1 text-xs text-[rgb(var(--muted-foreground))]">
        {label}
      </span>
    </div>
  );
}

function fastApiKeyFallback(config: ConfigDto, secret: SecretStatusDto): string {
  if (!config.fastAiProvider) return "Set provider first";
  const authentication = providerAuthentication(config.fastAiProvider);
  if (authentication === "none") return "No API key needed";
  if (authentication === "optional" && config.fastAiProvider !== config.aiProvider) return "Optional bearer token";
  if (config.fastAiProvider !== config.aiProvider) return "Stored in the encrypted secrets store";
  if (secret.configured) return "Reuses primary key";
  return authentication === "optional" ? "Optional bearer token" : "Set primary key first";
}

function localModelOption(model: LocalModelDto): ModelOption {
  return {
    value: model.id,
    label: model.displayName,
    detail: model.cached ? "cached" : model.managed ? "download needed" : model.filename,
  };
}

function modelOptionsForProvider(provider: string, localModelOptions: readonly ModelOption[]): readonly ModelOption[] | undefined {
  if (isLocalAiProvider(provider)) return localModelOptions;
  return undefined;
}

function selectFirstFamilyInference(
  catalogs: MeshLiveCatalogPeerDto[],
  setConfig: Dispatch<SetStateAction<ConfigDto>>,
  purpose: "primary" | "fast",
): void {
  const peer = catalogs.find((item) => item.inference.length > 0);
  const service = peer?.inference[0];
  const model = service?.models[0]?.id ?? "";
  if (!peer || !service) return;
  const provider = `mesh:${peer.peerId}:inference:${service.id}`;
  setConfig((current) => purpose === "primary"
    ? { ...current, aiProvider: provider, aiApiUrl: "", aiModel: model }
    : { ...current, fastAiProvider: provider, fastAiApiUrl: "", fastAiModel: model });
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
  if (
    nextProvider !== currentProvider
    || !currentModel
    || isLocalAiProvider(currentProvider)
    || isMeshInferenceProvider(currentProvider)
  ) {
    return defaultModelForProvider(nextProvider);
  }
  return currentModel;
}
