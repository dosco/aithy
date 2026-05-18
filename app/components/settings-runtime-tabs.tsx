import type { Dispatch, SetStateAction } from "react";
import { Check } from "lucide-react";
import type { PrimaryClearAction } from "@/components/settings-page-helpers";
import { saveButtonLabel } from "@/components/settings-page-helpers";
import {
  ApiKeyInput,
  Field,
  ModelCombobox,
  ProviderSelect,
  Section,
  fieldClass,
  selectClass,
} from "@/components/settings-form-bits";
import { GlobalMountsSection } from "@/components/settings-global-mounts";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ConfigDto, SecretStatusDto } from "@/server/dto";
import { isCustomOpenAIProvider } from "../../src/agent/ai-providers";

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
  apiKey: string;
  fastApiKey: string;
  setApiKey: (value: string) => void;
  setFastApiKey: (value: string) => void;
  setPrimaryClearAction: (action: PrimaryClearAction) => void;
}

interface SandboxTabProps extends RuntimeTabProps {
  skippedPaths: string[];
}

export function ModelSettingsTab(props: ModelTabProps) {
  const { config, setConfig, secret, fastSecret, apiKey, fastApiKey } = props;
  return (
    <div className="grid gap-5">
      <Section title="Primary" subtitle="Drives the executor, context, and final responder by default.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <ProviderSelect value={config.aiProvider} onChange={(value) => setConfigValue(setConfig, "aiProvider", value)} />
          </Field>
          <Field label="Model">
            <ModelCombobox
              provider={config.aiProvider}
              value={config.aiModel}
              onChange={(value) => setConfigValue(setConfig, "aiModel", value)}
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
        <Field label="API key">
          <ApiKeyInput
            value={apiKey}
            onChange={props.setApiKey}
            secret={secret}
            fallback="Stored in the encrypted secrets store"
            onClear={() => props.setPrimaryClearAction("key")}
          />
        </Field>
      </Section>

      <Section title="Fast model" subtitle="Optional. Used for responder + recursion calls; falls back to primary when empty." muted>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <ProviderSelect
              value={config.fastAiProvider}
              allowEmpty
              onChange={(value) => setConfigValue(setConfig, "fastAiProvider", value)}
            />
          </Field>
          <Field label="Model">
            <ModelCombobox
              provider={config.fastAiProvider}
              value={config.fastAiModel}
              disabled={!config.fastAiProvider}
              placeholder={config.fastAiProvider ? "e.g. gpt-4o-mini" : "set provider first"}
              onChange={(value) => setConfigValue(setConfig, "fastAiModel", value)}
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
        <Field label="API key">
          <ApiKeyInput
            value={fastApiKey}
            onChange={props.setFastApiKey}
            secret={fastSecret}
            disabled={!config.fastAiProvider}
            fallback={fastApiKeyFallback(config, secret)}
          />
        </Field>
      </Section>

      <SaveRow saved={props.saved} saveBusy={props.saveBusy} onSave={props.onSave} />
    </div>
  );
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
  if (config.fastAiProvider !== config.aiProvider) return "Stored in the encrypted secrets store";
  return secret.configured ? "Reuses primary key" : "Set primary key first";
}

function setConfigValue<K extends keyof ConfigDto>(
  setter: Dispatch<SetStateAction<ConfigDto>>,
  key: K,
  value: ConfigDto[K],
) {
  setter((current) => ({ ...current, [key]: value }));
}
