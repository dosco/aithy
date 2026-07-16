import { useMemo, useState, type ReactNode } from "react";
import { Cpu, HardDriveDownload, ListChecks } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { SetupStatusList } from "@/components/console/console-setup-status";
import { Field, ModelCombobox, Section, type ModelOption } from "@/components/settings-form-bits";
import { LocalInferenceTuningFields } from "@/components/local-inference-tuning-fields";
import { Button } from "@/components/ui/button";
import { setCachedSetupGateState } from "@/lib/setup-gate";
import { saveLocalInferenceSettings } from "@/server/actions.functions";
import type { ConfigDto, LocalInferencePageStateDto } from "@/server/dto";
import { isLocalAiProvider } from "../../src/agent/ai-providers";

export function LocalInferencePage({ initialState }: { initialState: LocalInferencePageStateDto }) {
  return (
    <PageFrame eyebrow="Runtime" title="Local inference">
      <LocalInferencePanel initialState={initialState} />
    </PageFrame>
  );
}

export function LocalInferencePanel({
  initialState,
  currentConfig,
}: {
  initialState: LocalInferencePageStateDto;
  currentConfig?: ConfigDto;
}) {
  const [state, setState] = useState(initialState);
  const [selectedModel, setSelectedModel] = useState(initialState.selectedLocalAgentModel);
  const [localInference, setLocalInference] = useState(initialState.config.localInference);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(
    () => state.localModels
      .filter((model) => !model.role || model.role === "chat")
      .map(localModelOption),
    [state.localModels],
  );
  const effectiveConfig = currentConfig ?? state.config;
  const localChatSelected = isLocalAiProvider(effectiveConfig.aiProvider)
    || isLocalAiProvider(effectiveConfig.fastAiProvider);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await saveLocalInferenceSettings({
        data: { localAgentModel: selectedModel, localInference },
      });
      setState((current) => ({
        ...current,
        config: result.config,
        settings: result.settings,
        selectedLocalAgentModel: result.config.localAgentModel,
        status: {
          ...current.status,
          modelId: result.config.localAgentModel,
          ready: result.setupGate.localInferenceReady,
          chatRequired: result.setupGate.localInferenceRequired,
          chatReady: result.setupGate.localInferenceReady,
          active: result.setupGate.localInferenceActive,
          error: result.setupGate.localInferenceError,
        },
      }));
      setLocalInference(result.config.localInference);
      setCachedSetupGateState(result.setupGate);
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save local inference settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Section title="Agent" subtitle="Local chat model used when the Models tab provider is Local.">
        <div className="grid gap-4">
          <Field label="Local chat model">
            <ModelCombobox
              provider="local"
              value={selectedModel}
              modelOptions={options}
              disabled={!localChatSelected}
              onChange={setSelectedModel}
            />
          </Field>
          {!localChatSelected ? (
            <p className="text-sm text-[rgb(var(--muted-foreground))]">
              Select Local in Models to start a local chat model.
            </p>
          ) : null}
        </div>
        <ModelSummary state={state} localChatSelected={localChatSelected} />
      </Section>

      <LocalInferenceTuningFields value={localInference} onChange={setLocalInference} />

      <RetrievalHealth state={state} />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={busy || selectedModel.trim().length === 0}>
          {saved ? "Saved" : busy ? "Saving..." : "Save local inference"}
        </Button>
        {error ? <p className="text-sm text-red-500" role="alert">{error}</p> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {state.coreModels.map((model) => (
          <ReadOnlyModelSection
            key={model.id}
            icon={model.role === "reranker" ? <ListChecks className="h-4 w-4" /> : <HardDriveDownload className="h-4 w-4" />}
            title={model.role === "chat" ? "Chat" : model.role === "embedding" ? "Embedding" : "Reranking"}
            model={model}
          />
        ))}
      </div>

      <Section title="Download status" muted>
        <SetupStatusList statuses={state.setupStatuses} />
        {state.setupStatuses.length === 0 ? (
          <p className="text-sm text-[rgb(var(--muted-foreground))]">No active local inference downloads.</p>
        ) : null}
      </Section>
    </div>
  );
}

function RetrievalHealth({ state }: { state: LocalInferencePageStateDto }) {
  const health = state.status.embeddingHealth;
  if (!health) return null;
  return (
    <Section title="Retrieval health" muted>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <HealthCell label="Memories" value={embeddedLabel(health.memories)} stale={health.memories.stale} />
        <HealthCell label="Episodes" value={embeddedLabel(health.episodes)} stale={health.episodes.stale} />
        <HealthCell label="Skill chunks" value={embeddedLabel(health.skills)} stale={health.skills.stale} />
        <HealthCell label="Knowledge chunks" value={embeddedLabel(health.knowledge)} stale={health.knowledge.stale} />
      </div>
      <div className="mt-3 grid gap-1 text-xs text-[rgb(var(--muted-foreground))]">
        <p>Reranker: {health.rerankerReady ? "active" : "inactive"}</p>
        {health.lastTargetedIndexAt ? <p>Last targeted index: {formatDate(health.lastTargetedIndexAt)}</p> : null}
        {health.lastBackfillAt ? <p>Last backfill: {formatDate(health.lastBackfillAt)}</p> : null}
        {health.lastIndexError ? <p className="text-red-500">Indexing error: {health.lastIndexError}</p> : null}
      </div>
    </Section>
  );
}

function HealthCell({ label, value, stale }: { label: string; value: string; stale: number }) {
  return (
    <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3 py-2">
      <p className="text-xs text-[rgb(var(--muted-foreground))]">{label}</p>
      <p className="font-mono text-sm">{value}</p>
      {stale > 0 ? <p className="text-xs text-amber-500">{stale} stale</p> : null}
    </div>
  );
}

function embeddedLabel(stats: NonNullable<LocalInferencePageStateDto["status"]["embeddingHealth"]>["memories"]): string {
  return `${stats.embedded}/${stats.total}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function ModelSummary({
  state,
  localChatSelected,
}: {
  state: LocalInferencePageStateDto;
  localChatSelected: boolean;
}) {
  const selected = state.localModels.find((model) => model.id === state.selectedLocalAgentModel);
  const label = localChatSelected
    ? state.status.chatReady ? "Local chat ready" : state.status.active ? "Preparing local chat" : "Local chat idle"
    : state.status.routerReady ? "Local memory endpoint ready" : state.status.routerActive ? "Preparing local memory endpoint" : "Local memory endpoint idle";
  return (
    <div className="grid gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--muted))]/30 px-3.5 py-3 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <Cpu className="h-4 w-4" />
        {label}
      </div>
      <p className="break-all text-xs text-[rgb(var(--muted-foreground))]">
        {selected?.cached ? selected.path : "Selected managed model will be downloaded into the Hugging Face cache when needed."}
      </p>
      {state.status.error ? <p className="text-xs text-red-500">{state.status.error}</p> : null}
      {state.status.restartInMs !== undefined ? (
        <p className="text-xs text-amber-600 dark:text-amber-300">
          Retrying local inference in {formatDelay(state.status.restartInMs)}.
        </p>
      ) : null}
      {state.status.binaryPath ? (
        <p className="break-all text-xs text-[rgb(var(--muted-foreground))]">
          llama-server ({state.status.binarySource ?? "resolved"}): {state.status.binaryPath}
        </p>
      ) : null}
    </div>
  );
}

function localModelOption(model: LocalInferencePageStateDto["localModels"][number]): ModelOption {
  return {
    value: model.id,
    label: model.displayName,
    detail: model.cached ? "cached" : model.managed ? "download needed" : model.filename,
  };
}

function formatDelay(ms: number): string {
  if (ms >= 1_000) return `${Math.ceil(ms / 1_000)}s`;
  return `${ms}ms`;
}

function ReadOnlyModelSection({
  icon,
  title,
  model,
}: {
  icon: ReactNode;
  title: string;
  model: LocalInferencePageStateDto["coreModels"][number];
}) {
  return (
    <Section title={title} muted>
      <div className="grid gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 py-3">
        <div className="flex items-center gap-3">
        <span className="text-[rgb(var(--muted-foreground))]">{icon}</span>
          <span className="min-w-0 truncate font-mono text-sm">{model.alias ?? model.displayName}</span>
          <span className="ml-auto text-xs text-[rgb(var(--muted-foreground))]">
            {model.cached ? "cached" : "download needed"}
          </span>
        </div>
        <p className="break-all text-xs text-[rgb(var(--muted-foreground))]">{model.id}</p>
        {model.path ? <p className="break-all text-xs text-[rgb(var(--muted-foreground))]">{model.path}</p> : null}
      </div>
    </Section>
  );
}
