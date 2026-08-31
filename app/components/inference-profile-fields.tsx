import type { Dispatch, SetStateAction } from "react";
import type { ConfigDto } from "@/server/dto";
import { Field, fieldClass, selectClass } from "@/components/settings-form-bits";
import {
  capabilitiesForProviderModel,
  endpointFieldsForProvider,
  providerUsesApiUrl,
  type AiServiceTier,
  type AiThinkingLevel,
} from "../../src/agent/ai-providers";

export function InferenceProfileFields({
  config,
  setConfig,
  purpose,
}: {
  config: ConfigDto;
  setConfig: Dispatch<SetStateAction<ConfigDto>>;
  purpose: "primary" | "fast";
}) {
  const provider = purpose === "primary" ? config.aiProvider : config.fastAiProvider;
  const model = purpose === "primary" ? config.aiModel : config.fastAiModel;
  const apiUrl = purpose === "primary" ? config.aiApiUrl : config.fastAiApiUrl;
  const profileArgs = purpose === "primary" ? config.aiProfileArgs : config.fastAiProfileArgs;
  const thinkingLevel = purpose === "primary" ? config.aiThinkingLevel : config.fastAiThinkingLevel;
  const serviceTier = purpose === "primary" ? config.aiServiceTier : config.fastAiServiceTier;
  const setApiUrl = (value: string) => setConfig((current) => purpose === "primary"
    ? { ...current, aiApiUrl: value }
    : { ...current, fastAiApiUrl: value });
  const setProfileArg = (name: string, value: string) => setConfig((current) => {
    const currentArgs = purpose === "primary" ? current.aiProfileArgs : current.fastAiProfileArgs;
    const nextArgs = { ...currentArgs, [name]: value };
    return purpose === "primary"
      ? { ...current, aiProfileArgs: nextArgs }
      : { ...current, fastAiProfileArgs: nextArgs };
  });
  const setThinkingLevel = (value: string) => setConfig((current) => purpose === "primary"
    ? { ...current, aiThinkingLevel: value as AiThinkingLevel | "" }
    : { ...current, fastAiThinkingLevel: value as AiThinkingLevel | "" });
  const setServiceTier = (value: string) => setConfig((current) => purpose === "primary"
    ? { ...current, aiServiceTier: value as AiServiceTier }
    : { ...current, fastAiServiceTier: value as AiServiceTier });

  return (
    <InferenceProfileInputs
      provider={provider}
      model={model}
      apiUrl={apiUrl}
      profileArgs={profileArgs}
      thinkingLevel={thinkingLevel}
      serviceTier={serviceTier}
      onApiUrlChange={setApiUrl}
      onProfileArgChange={setProfileArg}
      onThinkingLevelChange={setThinkingLevel}
      onServiceTierChange={setServiceTier}
    />
  );
}

export function InferenceProfileInputs({
  provider,
  model,
  apiUrl,
  profileArgs,
  thinkingLevel,
  serviceTier,
  onApiUrlChange,
  onProfileArgChange,
  onThinkingLevelChange,
  onServiceTierChange,
}: {
  provider: string;
  model: string;
  apiUrl: string;
  profileArgs: Readonly<Record<string, string>>;
  thinkingLevel: AiThinkingLevel | "";
  serviceTier: AiServiceTier;
  onApiUrlChange: (value: string) => void;
  onProfileArgChange: (name: string, value: string) => void;
  onThinkingLevelChange: (value: string) => void;
  onServiceTierChange: (value: string) => void;
}) {
  const endpointFields = endpointFieldsForProvider(provider);
  const capabilities = capabilitiesForProviderModel(provider, model);

  if (
    !providerUsesApiUrl(provider)
    && endpointFields.length === 0
    && capabilities.thinkingLevels.length === 0
    && capabilities.serviceTiers.length === 0
  ) return null;

  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      {providerUsesApiUrl(provider) ? (
        <div className="sm:col-span-2">
          <Field label="Base URL">
            <input
              className={fieldClass}
              value={apiUrl}
              onChange={(event) => onApiUrlChange(event.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </Field>
        </div>
      ) : null}
      {endpointFields.map((field) => (
        <Field key={field.name} label={`${field.label}${field.required ? " *" : ""}`}>
          <input
            className={fieldClass}
            value={profileArgs[field.name] ?? field.defaultValue ?? ""}
            onChange={(event) => onProfileArgChange(field.name, event.target.value)}
            placeholder={field.defaultValue}
          />
        </Field>
      ))}
      {capabilities.thinkingLevels.length > 0 ? (
        <Field label="Thinking level">
          <select className={selectClass} value={thinkingLevel} onChange={(event) => onThinkingLevelChange(event.target.value)}>
            <option value="">Model default</option>
            {capabilities.thinkingLevels.map((level) => (
              <option key={level} value={level}>{thinkingLevelLabel(level)}</option>
            ))}
          </select>
        </Field>
      ) : null}
      {capabilities.serviceTiers.length > 0 ? (
        <Field label="Service tier">
          <select className={selectClass} value={serviceTier} onChange={(event) => onServiceTierChange(event.target.value)}>
            <option value="auto">Auto</option>
            {capabilities.serviceTiers.map((tier) => (
              <option key={tier} value={tier}>{titleCase(tier)}</option>
            ))}
          </select>
        </Field>
      ) : null}
    </div>
  );
}

function thinkingLevelLabel(level: AiThinkingLevel): string {
  if (level === "none") return "None";
  if (level === "highest") return "Highest";
  return titleCase(level);
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
