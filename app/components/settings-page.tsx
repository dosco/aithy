import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Check } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageFrame } from "@/components/page-frame";
import { SettingsDangerZone } from "@/components/settings-danger-zone";
import {
  ApiKeyInput,
  Field,
  FormTextarea,
  ModelCombobox,
  ProviderSelect,
  Section,
  fieldClass,
  selectClass,
} from "@/components/settings-form-bits";
import { GlobalMountsSection } from "@/components/settings-global-mounts";
import { ThemeSync } from "@/components/theme-sync";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  saveSettings,
  saveSoul,
} from "@/server/actions.functions";
import type {
  ConfigDto,
  SecretStatusDto,
  SoulDto,
  WebStateDto,
} from "@/server/dto";

type PrimaryClearAction = "model" | "key";

export function SettingsPage({ initialState }: { initialState: WebStateDto }) {
  const router = useRouter();
  const [config, setConfig] = useState(initialState.config);
  const [secret, setSecret] = useState(initialState.secret);
  const [fastSecret, setFastSecret] = useState<SecretStatusDto | null>(initialState.fastSecret);
  const [apiKey, setApiKey] = useState("");
  const [fastApiKey, setFastApiKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [skippedPaths, setSkippedPaths] = useState<string[]>([]);
  const [soul, setSoul] = useState<SoulDto>(initialState.soul);
  const [soulSaved, setSoulSaved] = useState(false);
  const [ui, setUi] = useState(initialState.settings.ui);
  const [primaryClearAction, setPrimaryClearAction] = useState<PrimaryClearAction | null>(null);
  const [primaryClearBusy, setPrimaryClearBusy] = useState(false);

  async function save(options?: { clearApiKey?: boolean; clearAiModel?: boolean }) {
    const clearAiModel = options?.clearAiModel ?? config.aiModel.trim().length === 0;
    setSaveBusy(true);
    setSaveError(null);
    try {
      const result = await saveSettings({
        data: {
          runtime: {
            aiProvider: config.aiProvider,
            aiModel: clearAiModel ? null : config.aiModel,
            fastAiProvider: config.fastAiProvider,
            fastAiModel: config.fastAiModel,
            sandboxProvider: config.sandboxProvider === "disabled" ? "disabled" : "microsandbox",
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
      setSaveError(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSaveBusy(false);
    }
  }

  async function clearPrimary(action: PrimaryClearAction) {
    setPrimaryClearBusy(true);
    try {
      await save(action === "model" ? { clearAiModel: true } : { clearApiKey: true });
    } finally {
      setPrimaryClearBusy(false);
      setPrimaryClearAction(null);
    }
  }

  async function saveSoulFields() {
    const next = await saveSoul({
      data: {
        name: soul.name,
        description: soul.description,
        coreNature: soul.coreNature,
        communicationStyle: soul.communicationStyle,
        behaviour: soul.behaviour,
        negativeBehavior: soul.negativeBehavior,
      },
    });
    setSoul(next);
    setSoulSaved(true);
    setTimeout(() => setSoulSaved(false), 1400);
  }

  return (
    <PageFrame eyebrow="Control room" title="Local settings, model wiring, sandbox shape.">
      <ThemeSync ui={ui} />
      <Tabs defaultValue="model">
        <TabsList className="mb-6">
          <TabsTrigger value="model">Model</TabsTrigger>
          <TabsTrigger value="sandbox">Sandbox</TabsTrigger>
          <TabsTrigger value="ui">UI</TabsTrigger>
          <TabsTrigger value="soul">Soul</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        {saveError ? (
          <p className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500" role="alert">
            {saveError}
          </p>
        ) : null}

        <TabsContent value="model">
          <div className="grid gap-5">
            <Section title="Primary" subtitle="Drives the executor, context, and final responder by default.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Provider">
                  <ProviderSelect
                    value={config.aiProvider}
                    onChange={(value) => setConfigValue(setConfig, "aiProvider", value)}
                  />
                </Field>
                <Field label="Model">
                  <ModelCombobox
                    provider={config.aiProvider}
                    value={config.aiModel}
                    onChange={(value) => setConfigValue(setConfig, "aiModel", value)}
                    onClear={() => setPrimaryClearAction("model")}
                  />
                </Field>
              </div>
              <Field label="API key">
                <ApiKeyInput
                  value={apiKey}
                  onChange={setApiKey}
                  secret={secret}
                  fallback="Stored with Bun.secrets when saved"
                  onClear={() => setPrimaryClearAction("key")}
                />
              </Field>
            </Section>

            <Section
              title="Fast model"
              subtitle="Optional. Used for responder + recursion calls; falls back to primary when empty."
              muted
            >
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
              </div>
              <Field label="API key">
                <ApiKeyInput
                  value={fastApiKey}
                  onChange={setFastApiKey}
                  secret={fastSecret}
                  disabled={!config.fastAiProvider}
                  fallback={
                    !config.fastAiProvider
                      ? "Set provider first"
                      : config.fastAiProvider === config.aiProvider
                        ? secret.configured
                          ? "Reuses primary key"
                          : "Set primary key first"
                        : "Stored with Bun.secrets when saved"
                  }
                />
              </Field>
            </Section>

            <div className="flex justify-end pt-1">
              <Button onClick={() => void save()} disabled={saveBusy} className="sm:min-w-[140px]">
                {saved ? <Check className="h-4 w-4" /> : null}
                {saveButtonLabel(saveBusy, saved)}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="sandbox">
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
                  <>
                    <Field label="Image">
                      <input
                        className={fieldClass}
                        value={config.sandboxImage}
                        onChange={(event) => setConfigValue(setConfig, "sandboxImage", event.target.value)}
                      />
                    </Field>
                    <Field label="Network">
                      <select
                        value={config.sandboxNetwork}
                        onChange={(event) => setConfigValue(setConfig, "sandboxNetwork", event.target.value)}
                        className={selectClass}
                      >
                        <option value="none">none</option>
                        <option value="public">public</option>
                        <option value="allow-all">allow-all</option>
                      </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="CPUs">
                        <input
                          className={fieldClass}
                          type="number"
                          value={config.sandboxCpus}
                          onChange={(event) => setConfigValue(setConfig, "sandboxCpus", Number(event.target.value))}
                        />
                      </Field>
                      <Field label="Memory (MB)">
                        <input
                          className={fieldClass}
                          type="number"
                          value={config.sandboxMemoryMb}
                          onChange={(event) => setConfigValue(setConfig, "sandboxMemoryMb", Number(event.target.value))}
                        />
                      </Field>
                    </div>
                  </>
                ) : (
                  <Field label="Execution">
                    <input
                      className={fieldClass}
                      value="Local host via Bun Shell"
                      readOnly
                    />
                  </Field>
                )}
              </div>
            </Section>
            <Section title="Javascript Runtime" subtitle="Session lifecycle and tracing.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Session TTL (ms)">
                  <input
                    className={fieldClass}
                    type="number"
                    value={config.sessionTtlMs}
                    onChange={(event) => setConfigValue(setConfig, "sessionTtlMs", Number(event.target.value))}
                  />
                </Field>
                <Field label="Tracing">
                  <div className="flex h-11 items-center gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5">
                    <Switch
                      checked={config.traceEnabled}
                      onCheckedChange={(value) => setConfigValue(setConfig, "traceEnabled", value)}
                    />
                    <span className="text-sm text-[rgb(var(--muted-foreground))]">
                      {config.traceEnabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                </Field>
                <Field label={`Parallel agents (${config.parallelAgents})`}>
                  <div className="flex h-11 items-center gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5">
                    <input
                      type="range"
                      min={1}
                      max={8}
                      step={1}
                      value={config.parallelAgents}
                      onChange={(event) => setConfigValue(setConfig, "parallelAgents", Number(event.target.value))}
                      className="flex-1"
                      aria-label="Parallel agents"
                    />
                    <span className="w-6 text-right tabular-nums text-sm text-[rgb(var(--muted-foreground))]">
                      {config.parallelAgents}
                    </span>
                  </div>
                </Field>
              </div>
            </Section>
            {config.sandboxProvider === "microsandbox" ? (
              <GlobalMountsSection
                mounts={config.globalMounts}
                skippedPaths={skippedPaths}
                onChange={(next) => setConfigValue(setConfig, "globalMounts", next)}
              />
            ) : null}

            <div className="flex justify-end pt-1">
              <Button onClick={() => void save()} disabled={saveBusy} className="sm:min-w-[140px]">
                {saved ? <Check className="h-4 w-4" /> : null}
                {saveButtonLabel(saveBusy, saved)}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="ui">
          <div className="grid gap-5">
            <Section title="Chat" subtitle="Defaults for every chat tab.">
              <Field label="Debug details">
                <div className="flex h-11 items-center gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5">
                  <Switch
                    checked={ui.detailsDefault}
                    onCheckedChange={(value) => setUi({ ...ui, detailsDefault: value })}
                  />
                  <span className="text-sm text-[rgb(var(--muted-foreground))]">
                    {ui.detailsDefault ? "Shown by default" : "Hidden by default"}
                  </span>
                </div>
              </Field>
            </Section>
            <div className="flex justify-end pt-1">
              <Button onClick={() => void save()} disabled={saveBusy} className="sm:min-w-[140px]">
                {saved ? <Check className="h-4 w-4" /> : null}
                {saveButtonLabel(saveBusy, saved)}
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="soul">
          <Section title="Soul" subtitle="Identity + tone passed to the responder.">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name">
                  <input
                    className={fieldClass}
                    value={soul.name}
                    onChange={(e) => setSoul({ ...soul, name: e.target.value })}
                  />
                </Field>
                <Field label="Description">
                  <input
                    className={fieldClass}
                    value={soul.description}
                    onChange={(e) => setSoul({ ...soul, description: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Core nature">
                <FormTextarea rows={4} value={soul.coreNature} onChange={(e) => setSoul({ ...soul, coreNature: e.target.value })} />
              </Field>
              <Field label="Communication style">
                <FormTextarea rows={4} value={soul.communicationStyle} onChange={(e) => setSoul({ ...soul, communicationStyle: e.target.value })} />
              </Field>
              <Field label="Behaviour">
                <FormTextarea rows={4} value={soul.behaviour} onChange={(e) => setSoul({ ...soul, behaviour: e.target.value })} />
              </Field>
              <Field label="What to avoid">
                <FormTextarea rows={4} value={soul.negativeBehavior} onChange={(e) => setSoul({ ...soul, negativeBehavior: e.target.value })} />
              </Field>
              <div className="flex justify-end pt-1">
                <Button onClick={() => void saveSoulFields()}>
                  {soulSaved ? <Check className="h-4 w-4" /> : null}
                  Save soul
                </Button>
              </div>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="system">
          <SettingsDangerZone
            onSystemReset={(state) => {
              setConfig(state.config);
              setSecret(state.secret);
              setFastSecret(state.fastSecret);
              setSoul(state.soul);
              setUi(state.settings.ui);
              setApiKey("");
              setFastApiKey("");
              setSkippedPaths([]);
            }}
          />
        </TabsContent>

      </Tabs>

      <div className="mt-8 border-t border-[rgb(var(--border))] pt-5">
        <code className="truncate font-mono text-[11px] text-[rgb(var(--muted-foreground))]">
          {config.stateDbPath}
        </code>
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

function primaryClearCopy(action: PrimaryClearAction | null) {
  if (action === "key") {
    return {
      title: "Clear primary API key?",
      body: "Aithy will forget the stored primary key for this bot and return to setup until a key is set again.",
      confirmLabel: "Clear key",
    };
  }
  return {
    title: "Clear primary model?",
    body: "Aithy will remove the primary model and return to setup until a model is selected again.",
    confirmLabel: "Clear model",
  };
}

function setConfigValue<K extends keyof ConfigDto>(
  setter: Dispatch<SetStateAction<ConfigDto>>,
  key: K,
  value: ConfigDto[K],
) {
  setter((current) => ({ ...current, [key]: value }));
}

function saveButtonLabel(busy: boolean, saved: boolean) {
  if (busy) return "Testing...";
  return saved ? "Saved" : "Save settings";
}

function networkValue(value: string) {
  return value === "public" || value === "allow-all" ? value : "none";
}
