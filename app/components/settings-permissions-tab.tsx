import { useMemo, useState } from "react";
import { Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import {
  createPermissionRule,
  deletePermissionRule,
  resetPermissionRules,
} from "@/server/actions.functions";
import type { PermissionRuleDto } from "@/server/dto";
import { Button } from "@/components/ui/button";
import { Field, Section, fieldClass, selectClass } from "@/components/settings-form-bits";
import type { CapabilityMatchKind } from "../../src/security/capability-policy";

const capabilities = [
  ["web.search", "Web search"],
  ["web.scrape", "Website fetch"],
  ["sandbox.mount", "Sandbox mounts"],
  ["sandbox.getPath", "Sandbox path lookup"],
  ["system.bash", "Host shell"],
] as const;

const matchKinds = [
  ["global", "Always allow capability"],
  ["website_origin", "Website origin"],
  ["host_path_exact", "Host path"],
  ["host_path_prefix", "Host path prefix"],
  ["exact_command", "Exact command"],
  ["cwd_prefix", "Command folder prefix"],
] as const;

export function PermissionsSettingsTab({
  rules,
  onRulesChange,
}: {
  rules: PermissionRuleDto[];
  onRulesChange: (rules: PermissionRuleDto[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [capability, setCapability] = useState("web.search");
  const [matchKind, setMatchKind] = useState<CapabilityMatchKind>("global");
  const [matchValue, setMatchValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = useMemo(() => filterRules(rules, query), [rules, query]);

  async function addRule() {
    setBusy(true);
    setError(null);
    try {
      const result = await createPermissionRule({
        data: {
          capability,
          matchKind,
          matchValue: matchKind === "global" ? null : matchValue.trim(),
          reason: "added in settings",
        },
      });
      onRulesChange([result.rule, ...rules.filter((rule) => rule.id !== result.rule.id)]);
      setMatchValue("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add permission rule");
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deletePermissionRule({ data: { id } });
      onRulesChange(rules.filter((rule) => rule.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete permission rule");
    } finally {
      setBusy(false);
    }
  }

  async function resetRules() {
    setBusy(true);
    setError(null);
    try {
      await resetPermissionRules();
      onRulesChange([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset permission rules");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <Section
        title="Permission rules"
        subtitle="Most tools ask first. Saved rules skip future prompts when their scope matches. sandbox.bash is always allowed inside the VM."
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[rgb(var(--muted-foreground))]" />
            <input
              className={`${fieldClass} pl-9`}
              value={query}
              placeholder="Search capability, website, path, command..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Button type="button" variant="danger" disabled={busy || rules.length === 0} onClick={() => void resetRules()}>
            <RotateCcw className="h-4 w-4" /> Reset all
          </Button>
        </div>

        {error ? <p className="text-sm text-red-500">{error}</p> : null}

        <div className="grid gap-2">
          {filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[rgb(var(--border))] px-3 py-4 text-sm text-[rgb(var(--muted-foreground))]">
              No saved permission rules yet. The next governed tool request can create one from the permission card.
            </p>
          ) : null}
          {filtered.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-col gap-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/50 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium">{rule.capability}</span>
                  <span className="rounded-full bg-[rgb(var(--muted))] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[rgb(var(--muted-foreground))]">
                    {rule.matchKind}
                  </span>
                </div>
                <p className="mt-1 break-all text-sm text-[rgb(var(--muted-foreground))]">
                  {rule.matchValue ?? "Capability-wide allow"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void removeRule(rule.id)}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Add rule manually" subtitle="Useful for pre-approving a trusted website, folder, or capability.">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Capability">
            <select className={selectClass} value={capability} onChange={(event) => setCapability(event.target.value)}>
              {capabilities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Scope">
            <select className={selectClass} value={matchKind} onChange={(event) => setMatchKind(event.target.value as CapabilityMatchKind)}>
              {matchKinds.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Value">
            <input
              className={fieldClass}
              value={matchValue}
              disabled={matchKind === "global"}
              placeholder={matchKind === "global" ? "not needed" : "https://example.com or /Users/me/docs"}
              onChange={(event) => setMatchValue(event.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="button" disabled={busy || (matchKind !== "global" && !matchValue.trim())} onClick={() => void addRule()}>
            <Plus className="h-4 w-4" /> Add rule
          </Button>
        </div>
      </Section>
    </div>
  );
}

function filterRules(rules: PermissionRuleDto[], query: string): PermissionRuleDto[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rules;
  return rules.filter((rule) =>
    [rule.capability, rule.matchKind, rule.matchValue ?? "", rule.reason ?? ""]
      .some((value) => value.toLowerCase().includes(needle)),
  );
}
