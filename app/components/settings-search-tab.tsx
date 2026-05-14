import { useState, type Dispatch, type SetStateAction } from "react";
import { Check, Search } from "lucide-react";
import {
  ApiKeyInput,
  Field,
  Section,
  fieldClass,
} from "@/components/settings-form-bits";
import { Button } from "@/components/ui/button";
import { testParallelSearch } from "@/server/actions.functions";
import type {
  ConfigDto,
  ParallelSearchStatusDto,
  ParallelSearchTestDto,
} from "@/server/dto";
import { saveButtonLabel } from "./settings-page-helpers";

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
}: SearchSettingsTabProps) {
  const [testQuery, setTestQuery] = useState("Aithy Parallel Search MCP");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<ParallelSearchTestDto | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const urlError = validateSearchUrl(config.parallelSearchMcpUrl);
  const mode = parallelApiKey.trim() ? "api-key" : parallelSearch.mode;
  const canTest = !testBusy && !urlError && testQuery.trim().length >= 2;

  async function runTest() {
    if (!canTest) return;
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await testParallelSearch({
        data: {
          query: testQuery.trim(),
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
      <Section
        title="Public web search"
        subtitle="Parallel Search MCP works through the anonymous public endpoint by default. Add a Parallel API key only when you want higher limits."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="MCP endpoint">
            <input
              className={fieldClass}
              value={config.parallelSearchMcpUrl}
              onChange={(event) => setConfigValue(setConfig, "parallelSearchMcpUrl", event.target.value)}
              placeholder="https://search.parallel.ai/mcp"
            />
          </Field>
          <Field label="Mode">
            <div className="flex h-11 items-center rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 text-sm">
              {mode === "api-key" ? "API key override" : "Anonymous public search"}
            </div>
          </Field>
        </div>
        {urlError ? (
          <p className="text-sm text-red-500" role="alert">
            {urlError}
          </p>
        ) : null}
        <Field label="Parallel API key override">
          <ApiKeyInput
            value={parallelApiKey}
            onChange={setParallelApiKey}
            secret={parallelSearch}
            fallback="Anonymous mode: no key required"
            clearLabel={parallelApiKey ? "Clear pending Parallel API key" : "Use anonymous search"}
            onClear={() => {
              if (parallelApiKey) setParallelApiKey("");
              else onClearApiKey();
            }}
          />
        </Field>
      </Section>

      <Section title="Test search" subtitle="Runs the same Parallel MCP web.search path that the agent uses.">
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
              <span>{testResult.mode === "api-key" ? "API key" : "Anonymous"}</span>
              <span aria-hidden="true">/</span>
              <span>{testResult.provider}</span>
              <span aria-hidden="true">/</span>
              <span className="break-all">{testResult.url}</span>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-sans text-sm leading-6">
              {testResult.answer || "Search returned no text."}
            </pre>
          </div>
        ) : null}
      </Section>

      <div className="flex justify-end pt-1">
        <Button onClick={onSave} disabled={saveBusy || Boolean(urlError)} className="sm:min-w-[140px]">
          {saved ? <Check className="h-4 w-4" /> : null}
          {saveButtonLabel(saveBusy, saved)}
        </Button>
      </div>
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
