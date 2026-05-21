import type { ChangeEvent, ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { Field, fieldClass, Section, selectClass } from "@/components/settings-form-bits";
import { Button } from "@/components/ui/button";
import {
  LOCAL_INFERENCE_CONTEXT_SIZE_OPTIONS,
  LOCAL_INFERENCE_KV_CACHE_TYPES,
  defaultLocalInferenceSettings,
  type LocalInferenceSettings,
} from "../../src/local-inference/settings";

export function LocalInferenceTuningFields({
  value,
  onChange,
}: {
  value: LocalInferenceSettings;
  onChange: (value: LocalInferenceSettings) => void;
}) {
  function update<K extends keyof LocalInferenceSettings>(
    key: K,
    next: LocalInferenceSettings[K],
  ) {
    onChange({ ...value, [key]: next });
  }

  function numberField<K extends keyof LocalInferenceSettings>(
    key: K,
    fallback: number,
  ) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const next = Number(event.currentTarget.value);
      update(key, (Number.isFinite(next) ? next : fallback) as LocalInferenceSettings[K]);
    };
  }

  return (
    <>
      <Section title="Llama runtime" subtitle="Model load and context settings.">
        <Field label="llama-server binary">
          <WithDefault label="llama-server binary" setting="llamaServerPath" value={value.llamaServerPath} update={update}>
            <input
              value={value.llamaServerPath}
              onChange={(event) => update("llamaServerPath", event.currentTarget.value)}
              className={fieldClass}
              placeholder="Auto managed install or /path/to/llama-server"
            />
          </WithDefault>
        </Field>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Chat context">
            <WithDefault label="context size" setting="contextSize" value={value.contextSize} update={update}>
              <select
                value={value.contextSize}
                onChange={(event) => update("contextSize", Number(event.currentTarget.value))}
                className={selectClass}
              >
                {LOCAL_INFERENCE_CONTEXT_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size.toLocaleString()}</option>
                ))}
              </select>
            </WithDefault>
          </Field>
          <Field label="Embedding context">
            <WithDefault label="embedding context" setting="embeddingContextSize" value={value.embeddingContextSize} update={update}>
              <input
                type="number"
                min={1024}
                max={32768}
                step={1024}
                value={value.embeddingContextSize}
                onChange={numberField("embeddingContextSize", value.embeddingContextSize)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Reranker context">
            <WithDefault label="reranker context" setting="rerankerContextSize" value={value.rerankerContextSize} update={update}>
              <input
                type="number"
                min={1024}
                max={40960}
                step={1024}
                value={value.rerankerContextSize}
                onChange={numberField("rerankerContextSize", value.rerankerContextSize)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="GPU layers">
            <WithDefault label="GPU layers" setting="gpuLayers" value={value.gpuLayers} update={update}>
              <input
                type="number"
                min={0}
                max={999}
                step={1}
                value={value.gpuLayers}
                onChange={numberField("gpuLayers", value.gpuLayers)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Batch size">
            <WithDefault label="batch size" setting="batchSize" value={value.batchSize} update={update}>
              <input
                type="number"
                min={1}
                max={8192}
                step={128}
                value={value.batchSize}
                onChange={numberField("batchSize", value.batchSize)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Microbatch size">
            <WithDefault label="microbatch size" setting="ubatchSize" value={value.ubatchSize} update={update}>
              <input
                type="number"
                min={1}
                max={8192}
                step={128}
                value={value.ubatchSize}
                onChange={numberField("ubatchSize", value.ubatchSize)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Loaded models">
            <WithDefault label="loaded models" setting="modelsMax" value={value.modelsMax} update={update}>
              <input
                type="number"
                min={1}
                max={16}
                step={1}
                value={value.modelsMax}
                onChange={numberField("modelsMax", value.modelsMax)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="KV cache">
            <WithDefault label="KV cache" setting="kvCacheType" value={value.kvCacheType} update={update}>
              <select
                value={value.kvCacheType}
                onChange={(event) => {
                  update("kvCacheType", event.currentTarget.value as LocalInferenceSettings["kvCacheType"]);
                }}
                className={selectClass}
              >
                {LOCAL_INFERENCE_KV_CACHE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </WithDefault>
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <WithDefault label="flash attention" setting="flashAttention" value={value.flashAttention} update={update}>
            <label className="flex h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={value.flashAttention}
                onChange={(event) => update("flashAttention", event.currentTarget.checked)}
                className="h-4 w-4 rounded border-[rgb(var(--border))]"
              />
              <span>Flash attention</span>
            </label>
          </WithDefault>
          <WithDefault label="thinking mode" setting="thinkingMode" value={value.thinkingMode} update={update}>
            <label className="flex h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={value.thinkingMode}
                onChange={(event) => update("thinkingMode", event.currentTarget.checked)}
                className="h-4 w-4 rounded border-[rgb(var(--border))]"
              />
              <span>Thinking mode</span>
            </label>
          </WithDefault>
        </div>
      </Section>

      <Section title="Generation defaults" subtitle="Used when the caller does not override sampling.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Max tokens">
            <WithDefault label="max tokens" setting="maxOutputTokens" value={value.maxOutputTokens} update={update}>
              <input
                type="number"
                min={1}
                max={81920}
                step={1}
                value={value.maxOutputTokens}
                onChange={numberField("maxOutputTokens", value.maxOutputTokens)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Temperature">
            <WithDefault label="temperature" setting="temperature" value={value.temperature} update={update}>
              <input
                type="number"
                min={0}
                max={2}
                step={0.05}
                value={value.temperature}
                onChange={numberField("temperature", value.temperature)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Top P">
            <WithDefault label="top P" setting="topP" value={value.topP} update={update}>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={value.topP}
                onChange={numberField("topP", value.topP)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Top K">
            <WithDefault label="top K" setting="topK" value={value.topK} update={update}>
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={value.topK}
                onChange={numberField("topK", value.topK)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Min P">
            <WithDefault label="min P" setting="minP" value={value.minP} update={update}>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={value.minP}
                onChange={numberField("minP", value.minP)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Repeat penalty">
            <WithDefault label="repeat penalty" setting="repeatPenalty" value={value.repeatPenalty} update={update}>
              <input
                type="number"
                min={0}
                max={3}
                step={0.05}
                value={value.repeatPenalty}
                onChange={numberField("repeatPenalty", value.repeatPenalty)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Presence penalty">
            <WithDefault label="presence penalty" setting="presencePenalty" value={value.presencePenalty} update={update}>
              <input
                type="number"
                min={0}
                max={3}
                step={0.05}
                value={value.presencePenalty}
                onChange={numberField("presencePenalty", value.presencePenalty)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
          <Field label="Frequency penalty">
            <WithDefault label="frequency penalty" setting="frequencyPenalty" value={value.frequencyPenalty} update={update}>
              <input
                type="number"
                min={0}
                max={3}
                step={0.05}
                value={value.frequencyPenalty}
                onChange={numberField("frequencyPenalty", value.frequencyPenalty)}
                className={fieldClass}
              />
            </WithDefault>
          </Field>
        </div>
      </Section>
    </>
  );
}

function WithDefault<K extends keyof LocalInferenceSettings>({
  children,
  label,
  setting,
  value,
  update,
}: {
  children: ReactNode;
  label: string;
  setting: K;
  value: LocalInferenceSettings[K];
  update: (key: K, next: LocalInferenceSettings[K]) => void;
}) {
  const defaultValue = defaultLocalInferenceSettings[setting];
  const matchesDefault = value === defaultValue;
  return (
    <div className="grid gap-1.5">
      {children}
      <div className="flex min-h-7 items-center justify-between gap-2 text-xs text-[rgb(var(--muted-foreground))]">
        <span>Default: {formatDefault(defaultValue)}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Reset ${label} to default`}
          title={`Reset ${label} to default`}
          disabled={matchesDefault}
          onClick={() => update(setting, defaultValue)}
          className="h-7 w-7 text-[rgb(var(--muted-foreground))]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function formatDefault(value: LocalInferenceSettings[keyof LocalInferenceSettings]): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : String(value);
  return value || "auto";
}
