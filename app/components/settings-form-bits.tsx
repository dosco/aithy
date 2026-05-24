import type { ReactNode, TextareaHTMLAttributes } from "react";
import { useState } from "react";
import { Check, ChevronDown, KeyRound, X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { MeshInferenceProviderDto, SecretStatusDto } from "@/server/dto";
import {
  AX_AI_PROVIDERS,
  CUSTOM_OPENAI_PROVIDER,
  LOCAL_AI_PROVIDER,
  XAI_GROK_SUBSCRIPTION_PROVIDER,
  modelsForProvider,
  providerDisplayName,
} from "../../src/agent/ai-providers";

export const fieldClass =
  "h-11 w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 text-sm text-[rgb(var(--foreground))] caret-[rgb(var(--foreground))] outline-none transition placeholder:text-[rgb(var(--muted-foreground))] read-only:bg-[rgb(var(--muted))]/35 read-only:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:bg-[rgb(var(--muted))]/50 disabled:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--foreground))]";

export const selectClass =
  `${fieldClass} appearance-none pr-10 bg-no-repeat bg-[right_0.875rem_center] bg-[length:0.75rem_0.75rem] cursor-pointer bg-[image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23888' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'><polyline points='3,6 8,11 13,6'/></svg>")] [&>option]:bg-[rgb(var(--panel))] [&>option]:text-[rgb(var(--foreground))] [&>optgroup]:bg-[rgb(var(--panel))] [&>optgroup]:text-[rgb(var(--foreground))]`;

export interface ModelOption {
  value: string;
  label: string;
  detail?: string;
}

export interface ProviderOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface ProviderGroup {
  label: string;
  options: ProviderOption[];
}

export function Section({
  title,
  subtitle,
  children,
  muted = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <section
      className={cn(
        "grid gap-4 rounded-2xl border border-[rgb(var(--border))] p-5",
        muted ? "bg-[rgb(var(--muted))]/30" : "bg-[rgb(var(--panel))]/40",
      )}
    >
      <header className="grid gap-1">
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
        {subtitle ? <p className="text-xs text-[rgb(var(--muted-foreground))]">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-[rgb(var(--muted-foreground))]">
        {label}
      </span>
      {children}
    </label>
  );
}

export function ApiKeyInput({
  value,
  onChange,
  secret,
  disabled,
  fallback,
  onClear,
  clearLabel = "Clear API key",
}: {
  value: string;
  onChange: (value: string) => void;
  secret: SecretStatusDto | null;
  disabled?: boolean;
  fallback: string;
  onClear?: () => void;
  clearLabel?: string;
}) {
  const placeholder = secret?.configured ? `Stored in ${secret.source}` : fallback;
  const canClear = Boolean(onClear) && (secret?.configured || value.length > 0);
  return (
    <div
      className={cn(
        "flex items-stretch overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] text-[rgb(var(--foreground))] transition focus-within:border-[rgb(var(--foreground))]",
        disabled && "bg-[rgb(var(--muted))]/35 text-[rgb(var(--muted-foreground))]",
      )}
    >
      <span className="flex items-center px-3 text-[rgb(var(--muted-foreground))]">
        <KeyRound className="h-4 w-4" />
      </span>
      <input
        type="password"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        className="h-11 w-full bg-transparent pr-3.5 text-sm text-[rgb(var(--foreground))] caret-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted-foreground))] disabled:cursor-not-allowed disabled:text-[rgb(var(--muted-foreground))]"
      />
      {secret?.configured ? (
        <span className="flex shrink-0 items-center gap-1 border-l border-[rgb(var(--border))] px-3 text-[10px] font-medium uppercase tracking-wider text-[rgb(var(--muted-foreground))]">
          <Check className="h-3 w-3" /> {secret.source}
        </span>
      ) : null}
      {onClear ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={clearLabel}
          title={clearLabel}
          disabled={disabled || !canClear}
          onClick={onClear}
          className="h-11 w-11 shrink-0 rounded-none border-0 border-l border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))]"
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

export function ModelCombobox({
  provider,
  value,
  onChange,
  disabled,
  placeholder,
  onClear,
  modelOptions,
  clearLabel = "Clear model",
}: {
  provider: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  onClear?: () => void;
  modelOptions?: readonly (string | ModelOption)[];
  clearLabel?: string;
}) {
  const models = normalizeModelOptions(modelOptions ?? (provider ? modelsForProvider(provider) : []));
  const options = value && !models.some((model) => model.value === value)
    ? [modelOption(value), ...models]
    : models;
  const selected = options.find((model) => model.value === value);
  const canClear = Boolean(onClear) && value.trim().length > 0;
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const displayValue = selected?.label && !open && !focused ? selected.label : value;

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setFocused(false);
        }
      }}
    >
      <div
        className={cn(
          "flex items-stretch overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] text-[rgb(var(--foreground))] transition focus-within:border-[rgb(var(--foreground))]",
          disabled && "bg-[rgb(var(--muted))]/35 text-[rgb(var(--muted-foreground))]",
        )}
      >
        <input
          className="h-11 w-full bg-transparent px-3.5 text-sm text-[rgb(var(--foreground))] caret-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted-foreground))] disabled:cursor-not-allowed disabled:text-[rgb(var(--muted-foreground))]"
          value={displayValue}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => {
            setFocused(true);
            if (!disabled && options.length > 0) setOpen(true);
          }}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
        />
        {options.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Show model options"
            title="Show model options"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setOpen((current) => !current)}
            className="h-11 w-11 shrink-0 rounded-none border-0 border-l border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))]"
          >
            <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
          </Button>
        ) : null}
        {onClear ? <ClearButton label={clearLabel} disabled={disabled || !canClear} onClear={onClear} /> : null}
      </div>
      {open && options.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-64 overflow-auto rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-1.5 shadow-lg">
          {options.map((model) => (
            <button
              key={model.value}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(model.value);
                setOpen(false);
                setFocused(false);
              }}
              className={cn(
                "flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-[rgb(var(--foreground))] transition hover:bg-[rgb(var(--muted))] focus:bg-[rgb(var(--muted))] focus:outline-none",
                model.value === value && "bg-[rgb(var(--muted))] font-medium",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate">{model.label}</span>
                {model.detail ? (
                  <span className="block truncate text-xs font-normal text-[rgb(var(--muted-foreground))]">
                    {model.detail}
                  </span>
                ) : null}
              </span>
              {model.value === value ? <Check className="h-4 w-4 shrink-0" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeModelOptions(options: readonly (string | ModelOption)[]): ModelOption[] {
  return options.map((option) => typeof option === "string" ? modelOption(option) : option);
}

function modelOption(value: string): ModelOption {
  return { value, label: value };
}

function ClearButton({
  label,
  disabled,
  onClear,
}: {
  label: string;
  disabled?: boolean;
  onClear: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClear}
      className="h-11 w-11 shrink-0 rounded-none border-0 border-l border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))]"
    >
      <X className="h-4 w-4" />
    </Button>
  );
}

export function ProviderSelect({
  value,
  onChange,
  allowEmpty = false,
  meshInferenceProviders = [],
  providerSecrets = {},
}: {
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
  meshInferenceProviders?: readonly MeshInferenceProviderDto[];
  providerSecrets?: Record<string, SecretStatusDto>;
}) {
  const groups = providerGroups(meshInferenceProviders);
  const knownValues = new Set(groups.flatMap((group) => group.options.map((option) => option.value)));
  const optionLabel = (option: ProviderOption) =>
    providerSecrets[option.value]?.configured ? `${option.label} 🔑` : option.label;
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
      {allowEmpty ? <option value="">- none -</option> : null}
      {!knownValues.has(value) && value ? (
        <optgroup label="Current">
          <option value={value}>
            {providerSecrets[value]?.configured ? `${providerDisplayName(value)} 🔑` : providerDisplayName(value)}
          </option>
        </optgroup>
      ) : null}
      {groups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled && option.value !== value}>
              {optionLabel(option)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function providerGroups(meshInferenceProviders: readonly MeshInferenceProviderDto[]): ProviderGroup[] {
  const localOptions: ProviderOption[] = [
    { value: LOCAL_AI_PROVIDER, label: providerDisplayName(LOCAL_AI_PROVIDER) },
  ];
  const familyOptions: ProviderOption[] = meshInferenceProviders.map((provider) => ({
    value: provider.providerId,
    label: provider.online ? provider.name : `${provider.name} (offline)`,
    disabled: !provider.online,
  }));
  const hostedOptions = AX_AI_PROVIDERS
    .filter((provider) =>
      provider !== LOCAL_AI_PROVIDER
      && provider !== XAI_GROK_SUBSCRIPTION_PROVIDER
      && provider !== CUSTOM_OPENAI_PROVIDER
    )
    .map((provider) => ({ value: provider, label: providerDisplayName(provider) }));
  return [
    { label: "Local", options: localOptions },
    { label: "Family Aithys", options: familyOptions },
    { label: "Hosted providers", options: hostedOptions },
    {
      label: "Sign-in providers",
      options: [{ value: XAI_GROK_SUBSCRIPTION_PROVIDER, label: providerDisplayName(XAI_GROK_SUBSCRIPTION_PROVIDER) }],
    },
    {
      label: "Custom endpoints",
      options: [{ value: CUSTOM_OPENAI_PROVIDER, label: providerDisplayName(CUSTOM_OPENAI_PROVIDER) }],
    },
  ].filter((group) => group.options.length > 0);
}

export function FormTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Textarea
      {...props}
      className={cn(
        "rounded-xl border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 py-2.5 text-sm text-[rgb(var(--foreground))] caret-[rgb(var(--foreground))]",
        props.className,
      )}
    />
  );
}
