import { useState, type Dispatch, type SetStateAction } from "react";
import { Search } from "lucide-react";
import { FamilySearchSelector } from "@/components/family-mesh-selectors";
import {
  ApiKeyInput,
  Field,
  Section,
  fieldClass,
  selectClass,
} from "@/components/settings-form-bits";
import { SettingsSaveBar } from "@/components/settings-save-bar";
import { Button } from "@/components/ui/button";
import { testParallelSearch } from "@/server/actions.functions";
import type {
  ConfigDto,
  MeshLiveCatalogPeerDto,
  ParallelSearchStatusDto,
  ParallelSearchTestDto,
} from "@/server/dto";
import { isMeshSearchProvider } from "../../src/mesh/types";

interface SearchSettingsTabProps {
  config: ConfigDto;
  setConfig: Dispatch<SetStateAction<ConfigDto>>;
  parallelSearch: ParallelSearchStatusDto;
  parallelApiKey: string;
  setParallelApiKey: (value: string) => void;
  saved: boolean;
  saveBusy: boolean;
  onSave: () => void;
  onClearApiKey: () => void;
  meshCatalogs: MeshLiveCatalogPeerDto[];
  onRefreshMeshCatalogs?: () => void;
}

export function SearchSettingsTab({
  config,
  setConfig,
  parallelSearch,
  parallelApiKey,
  setParallelApiKey,
  saved,
  saveBusy,
  onSave,
  onClearApiKey,
  meshCatalogs,
  onRefreshMeshCatalogs,
}: SearchSettingsTabProps) {
  const [testQuery, setTestQuery] = useState("Aithy Parallel Search MCP");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<ParallelSearchTestDto | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const familySearch = isMeshSearchProvider(config.searchProvider);
  const urlError = config.searchProvider === "parallel" ? validateSearchUrl(config.parallelSearchMcpUrl) : null;
  const selectedProfile = config.searchProviderProfiles?.[config.searchProvider];
  const mode = parallelSearch.mode === "grok-subscription"
    ? "grok-subscription"
    : parallelApiKey.trim() ? "api-key" : parallelSearch.mode;
  const parallelSecret = parallelSearch.provider === "parallel"
    ? parallelSearch
    : { provider: "parallel", configured: false, source: null };
  const canTest = !familySearch && !testBusy && !urlError && testQuery.trim().length >= 2;

  async function runTest() {
    if (!canTest) return;
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await testParallelSearch({
        data: {
          query: testQuery.trim(),
          provider: config.searchProvider,
          url: config.parallelSearchMcpUrl.trim(),
          apiKey: parallelApiKey || undefined,
        },
      });
      setTestResult(result);
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "Search test failed");
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <SettingsSaveBar saved={saved} saveBusy={saveBusy} onSave={onSave} disabled={Boolean(urlError)} />
      <Section
        title="Web search"
        subtitle="Choose this Aithy's search backend or route searches through a live family service."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Source">
            <select className={selectClass} value={familySearch ? "family" : "local"} onChange={(event) => {
              if (event.target.value === "family") selectFirstFamilySearch(meshCatalogs, setConfig);
              else setConfig((current) => ({ ...current, searchProvider: "parallel" }));
            }}>
              <option value="local">This Aithy</option>
              <option value="family">Family Aithy</option>
            </select>
          </Field>
          {familySearch ? null : (
          <Field label="Provider">
            <select
              className={selectClass}
              value={config.searchProvider}
              onChange={(event) => {
                const provider = event.target.value as ConfigDto["searchProvider"];
                setConfig((current) => {
                  const profile = current.searchProviderProfiles?.[provider];
                  return {
                    ...current,
                    searchProvider: provider,
                    parallelSearchMcpUrl: provider === "parallel"
                      ? profile?.url ?? current.parallelSearchMcpUrl
                      : current.parallelSearchMcpUrl,
                  };
                });
              }}
            >
              <option value="parallel">Parallel</option>
              <option value="grok-subscription">Grok subscription</option>
            </select>
          </Field>
          )}
        </div>
        {familySearch ? (
          <FamilySearchSelector
            catalogs={meshCatalogs}
            config={config}
            setConfig={setConfig}
            onRefresh={onRefreshMeshCatalogs}
          />
        ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="MCP endpoint">
            <input
              className={fieldClass}
              value={config.parallelSearchMcpUrl}
              onChange={(event) => setConfigValue(setConfig, "parallelSearchMcpUrl", event.target.value)}
              placeholder="https://search.parallel.ai/mcp"
              disabled={config.searchProvider !== "parallel"}
            />
          </Field>
          <Field label="Mode">
            <div className="flex h-11 items-center rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 text-sm">
              {searchModeLabel(mode)}
            </div>
          </Field>
        </div>
        )}
        {urlError ? (
          <p className="text-sm text-red-500" role="alert">
            {urlError}
          </p>
        ) : null}
        <ValidationBadge validation={selectedProfile?.validation} />
        {!familySearch ? <Field label="Parallel API key">
          <ApiKeyInput
            value={parallelApiKey}
            onChange={setParallelApiKey}
            secret={parallelSecret}
            fallback="Anonymous mode: no key required"
            disabled={config.searchProvider !== "parallel"}
            clearLabel={parallelApiKey ? "Clear pending Parallel API key" : "Use anonymous search"}
            onClear={() => {
              if (parallelApiKey) setParallelApiKey("");
              else onClearApiKey();
            }}
          />
        </Field> : null}
      </Section>

      {!familySearch ? <Section title="Test search" subtitle="Runs the same web.search route that the agent uses.">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Query">
            <input
              className={fieldClass}
              value={testQuery}
              onChange={(event) => setTestQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runTest();
              }}
            />
          </Field>
          <Button type="button" onClick={() => void runTest()} disabled={!canTest} className="h-11">
            <Search className="h-4 w-4" />
            {testBusy ? "Testing..." : "Run test"}
          </Button>
        </div>
        {testError ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500" role="alert">
            {testError}
          </p>
        ) : null}
        {testResult ? (
          <div className="grid gap-2 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--muted-foreground))]">
              <span>{searchModeLabel(testResult.mode)}</span>
              <span aria-hidden="true">/</span>
              <span>{testResult.provider === "grok-subscription" ? "Grok subscription" : "Parallel"}</span>
              <span aria-hidden="true">/</span>
              <span className="break-all">{testResult.url}</span>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6">
              {testResult.answer || "Search returned no text."}
            </pre>
          </div>
        ) : null}
      </Section> : null}
    </div>
  );
}

function searchModeLabel(mode: ParallelSearchStatusDto["mode"]): string {
  if (mode === "grok-subscription") return "Grok subscription";
  if (mode === "api-key") return "Parallel API key";
  return "Parallel anonymous";
}

function selectFirstFamilySearch(
  catalogs: MeshLiveCatalogPeerDto[],
  setConfig: Dispatch<SetStateAction<ConfigDto>>,
): void {
  const peer = catalogs.find((item) => item.search.length > 0);
  const service = peer?.search[0];
  if (!peer || !service) return;
  const provider = `mesh:${peer.peerId}:search:${service.id}` as ConfigDto["searchProvider"];
  setConfig((current) => ({ ...current, searchProvider: provider, searchApiUrl: "" }));
}

function ValidationBadge({ validation }: { validation?: NonNullable<ConfigDto["searchProviderProfiles"]>[string]["validation"] }) {
  if (!validation) return null;
  const label = validation.status === "valid"
    ? "Validated"
    : validation.status === "not-required"
      ? "Validation not required"
      : validation.status === "invalid"
        ? "Validation failed"
        : "Needs validation";
  return (
    <div className="flex">
      <span className="rounded-full border border-[rgb(var(--border))] px-2.5 py-1 text-xs text-[rgb(var(--muted-foreground))]">
        {label}
      </span>
    </div>
  );
}

function setConfigValue<K extends keyof ConfigDto>(
  setter: Dispatch<SetStateAction<ConfigDto>>,
  key: K,
  value: ConfigDto[K],
) {
  setter((current) => ({ ...current, [key]: value }));
}

function validateSearchUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Parallel Search MCP URL is required.";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "Parallel Search MCP URL must start with http:// or https://.";
    }
    if (url.username || url.password) {
      return "Parallel Search MCP URL must not include embedded credentials.";
    }
  } catch {
    return "Parallel Search MCP URL must be a valid URL.";
  }
  return null;
}
