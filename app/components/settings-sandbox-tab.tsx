import type { Dispatch, SetStateAction } from "react";
import { Field, Section, fieldClass, selectClass } from "@/components/settings-form-bits";
import { GlobalMountsSection } from "@/components/settings-global-mounts";
import { SettingsSaveBar } from "@/components/settings-save-bar";
import { Switch } from "@/components/ui/switch";
import type { ConfigDto } from "@/server/dto";

interface SandboxTabProps {
  config: ConfigDto;
  setConfig: Dispatch<SetStateAction<ConfigDto>>;
  skippedPaths: string[];
  saved: boolean;
  saveBusy: boolean;
  onSave: () => void;
}

export function SandboxSettingsTab({ config, setConfig, skippedPaths, saved, saveBusy, onSave }: SandboxTabProps) {
  return (
    <div className="grid gap-5">
      <SettingsSaveBar saved={saved} saveBusy={saveBusy} onSave={onSave} />
      <Section title="Sandbox" subtitle="Where tool calls execute. Disabled mode runs local Bun Shell commands without isolation.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <select value={config.sandboxProvider} onChange={(event) => setConfigValue(setConfig, "sandboxProvider", event.target.value)} className={selectClass}>
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
    </div>
  );
}

function MicrosandboxFields({ config, setConfig }: Pick<SandboxTabProps, "config" | "setConfig">) {
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

function RuntimeFields({ config, setConfig }: Pick<SandboxTabProps, "config" | "setConfig">) {
  return (
    <Section title="Javascript Runtime" subtitle="Session lifecycle and tracing.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Host shell">
          <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5">
            <span className="text-sm text-[rgb(var(--muted-foreground))]">
              {config.systemBashEnabled ? "system.bash available with approval" : "system.bash disabled"}
            </span>
            <Switch checked={config.systemBashEnabled} onCheckedChange={(value) => setConfigValue(setConfig, "systemBashEnabled", value)} />
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

function setConfigValue<K extends keyof ConfigDto>(
  setter: Dispatch<SetStateAction<ConfigDto>>,
  key: K,
  value: ConfigDto[K],
) {
  setter((current) => ({ ...current, [key]: value }));
}
