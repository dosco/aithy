import type { Dispatch, SetStateAction } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Field, Section, fieldClass, selectClass } from "@/components/settings-form-bits";
import { GlobalMountsSection } from "@/components/settings-global-mounts";
import { SettingsSaveBar } from "@/components/settings-save-bar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ConfigDto } from "@/server/dto";

const DEFAULT_IMAGE_SELECTION = { kind: "internal", id: "aithy-sandbox" } satisfies ConfigDto["sandboxImageSelection"];

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
        <select className={selectClass} value={selectionValue(config.sandboxImageSelection)} onChange={(event) => selectSandboxImage(setConfig, event.target.value)}>
          <optgroup label="Aithy images">
            {config.sandboxImageOptions.filter((image) => image.kind === "internal").map((image) => (
              <option key={`${image.kind}:${image.id}`} value={`${image.kind}:${image.id}`}>{image.name}</option>
            ))}
          </optgroup>
          {config.sandboxImageOptions.some((image) => image.kind === "custom") ? (
            <optgroup label="Custom images">
              {config.sandboxImageOptions.filter((image) => image.kind === "custom").map((image) => (
                <option key={`${image.kind}:${image.id}`} value={`${image.kind}:${image.id}`}>{image.name}</option>
              ))}
            </optgroup>
          ) : null}
        </select>
      </Field>
      <Field label="Resolved image">
        <input className={fieldClass} value={config.sandboxImage} readOnly />
      </Field>
      <CustomImageControls config={config} setConfig={setConfig} />
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

function CustomImageControls({ config, setConfig }: Pick<SandboxTabProps, "config" | "setConfig">) {
  const selected = config.sandboxImageSelection.kind === "custom"
    ? config.customSandboxImages.find((image) => image.id === config.sandboxImageSelection.id)
    : undefined;
  if (!selected) {
    return (
      <div className="sm:col-span-2">
        <Button type="button" variant="soft" size="sm" onClick={() => addCustomImage(setConfig)}>
          <Plus className="h-4 w-4" /> Add custom image
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.22)] p-3 sm:col-span-2 sm:grid-cols-[1fr_1.4fr_auto]">
      <Field label="Custom name">
        <input className={fieldClass} value={selected.name} onChange={(event) => updateCustomImage(setConfig, selected.id, { name: event.target.value })} />
      </Field>
      <Field label="Custom image ref">
        <input className={fieldClass} value={selected.image} onChange={(event) => updateCustomImage(setConfig, selected.id, { image: event.target.value })} />
      </Field>
      <div className="flex items-end gap-2">
        <Button type="button" variant="soft" size="icon" aria-label="Add custom image" title="Add custom image" onClick={() => addCustomImage(setConfig)}>
          <Plus className="h-4 w-4" />
        </Button>
        <Button type="button" variant="danger" size="icon" aria-label="Delete custom image" title="Delete custom image" onClick={() => deleteCustomImage(setConfig, selected.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
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

function selectionValue(selection: ConfigDto["sandboxImageSelection"]): string {
  return `${selection.kind}:${selection.id}`;
}

function selectSandboxImage(setter: Dispatch<SetStateAction<ConfigDto>>, value: string): void {
  const [kind, id] = value.split(":", 2);
  if ((kind !== "internal" && kind !== "custom") || !id) return;
  const selection: ConfigDto["sandboxImageSelection"] = kind === "custom"
    ? { kind: "custom", id }
    : id === "aithy-sandbox" || id === "aithy-sandbox-lite"
      ? { kind: "internal", id }
      : DEFAULT_IMAGE_SELECTION;
  setter((current) => ({
    ...current,
    sandboxImageSelection: selection,
    sandboxImage: current.sandboxImageOptions.find((image) => image.kind === kind && image.id === id)?.image ?? current.sandboxImage,
  }));
}

function addCustomImage(setter: Dispatch<SetStateAction<ConfigDto>>): void {
  setter((current) => {
    const id = `custom-${crypto.randomUUID()}`;
    const image = { id, name: "Custom image", image: "" };
    return {
      ...current,
      customSandboxImages: [...current.customSandboxImages, image],
      sandboxImageOptions: [...current.sandboxImageOptions, { kind: "custom", id, name: image.name, image: image.image }],
      sandboxImageSelection: { kind: "custom", id },
      sandboxImage: "",
    };
  });
}

function updateCustomImage(
  setter: Dispatch<SetStateAction<ConfigDto>>,
  id: string,
  patch: Partial<ConfigDto["customSandboxImages"][number]>,
): void {
  setter((current) => {
    const customSandboxImages = current.customSandboxImages.map((image) => image.id === id ? { ...image, ...patch } : image);
    const selected = customSandboxImages.find((image) => image.id === current.sandboxImageSelection.id);
    return {
      ...current,
      customSandboxImages,
      sandboxImageOptions: current.sandboxImageOptions.map((option) => option.kind === "custom" && option.id === id ? { ...option, ...patch } : option),
      sandboxImage: current.sandboxImageSelection.kind === "custom" && selected ? selected.image : current.sandboxImage,
    };
  });
}

function deleteCustomImage(setter: Dispatch<SetStateAction<ConfigDto>>, id: string): void {
  setter((current) => {
    const internal = current.sandboxImageOptions.find((image) => image.kind === "internal" && image.id === DEFAULT_IMAGE_SELECTION.id);
    return {
      ...current,
      customSandboxImages: current.customSandboxImages.filter((image) => image.id !== id),
      sandboxImageOptions: current.sandboxImageOptions.filter((image) => image.kind !== "custom" || image.id !== id),
      sandboxImageSelection: DEFAULT_IMAGE_SELECTION,
      sandboxImage: internal?.image ?? current.sandboxImage,
    };
  });
}
