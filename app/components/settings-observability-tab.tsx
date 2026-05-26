import type { Dispatch, SetStateAction } from "react";
import { Database, LineChart } from "lucide-react";
import { Field, Section } from "@/components/settings-form-bits";
import { SettingsSaveBar } from "@/components/settings-save-bar";
import { Switch } from "@/components/ui/switch";
import type { ConfigDto } from "@/server/dto";

interface ObservabilityTabProps {
  config: ConfigDto;
  setConfig: Dispatch<SetStateAction<ConfigDto>>;
  saved: boolean;
  saveBusy: boolean;
  onSave: () => void;
}

export function ObservabilitySettingsTab({ config, setConfig, saved, saveBusy, onSave }: ObservabilityTabProps) {
  return (
    <div className="grid gap-5">
      <SettingsSaveBar saved={saved} saveBusy={saveBusy} onSave={onSave} />
      <Section title="Usage Metrics" subtitle="Local SQLite token totals power the Usage page.">
        <div className="flex min-h-11 items-center gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 text-sm text-[rgb(var(--muted-foreground))]">
          <LineChart className="h-4 w-4 shrink-0" />
          <span>Captured for model, provider, purpose, component, stage, run, and cache accounting.</span>
        </div>
      </Section>
      <Section title="Training Data Capture" subtitle="Opt-in local capture for later SFT JSONL export.">
        <Field label="Capture">
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5">
            <span className="flex min-w-0 items-center gap-2 text-sm text-[rgb(var(--muted-foreground))]">
              <Database className="h-4 w-4 shrink-0" />
              <span>{config.trainingDataCaptureEnabled ? "Enabled" : "Disabled"}</span>
            </span>
            <Switch
              checked={config.trainingDataCaptureEnabled}
              onCheckedChange={(value) => setConfig((current) => ({
                ...current,
                trainingDataCaptureEnabled: value,
                traceEnabled: value,
              }))}
            />
          </div>
        </Field>
        <p className="text-xs leading-5 text-[rgb(var(--muted-foreground))]">
          Captured traces can include prompts, assistant replies, tool outputs, model usage, and provider request identifiers. Data stays in the local Aithy state database until exported or deleted.
        </p>
      </Section>
    </div>
  );
}
