import { useState } from "react";
import { Check } from "lucide-react";
import { PageFrame } from "@/components/page-frame";
import { ThemeSync } from "@/components/theme-sync";
import {
  layoutDescriptions,
  layoutLabels,
  layoutNames,
  themeLabels,
  themeNames,
  themePreviews,
} from "@/lib/themes";
import { saveSettings } from "@/server/actions.functions";
import type { WebStateDto } from "@/server/dto";
import type { LayoutName, ThemeName } from "../../src/settings/types";

export function ThemesPage({ initialState }: { initialState: WebStateDto }) {
  const [theme, setTheme] = useState(initialState.settings.ui.theme);
  const [layout, setLayout] = useState(initialState.settings.ui.layout);

  async function pick(name: ThemeName) {
    setTheme(name);
    await saveSettings({ data: { ui: { theme: name, layout } } });
  }

  async function pickLayout(name: LayoutName) {
    setLayout(name);
    await saveSettings({ data: { ui: { theme, layout: name } } });
  }

  return (
    <PageFrame eyebrow="Surface" title="Themes with a little terminal electricity.">
      <ThemeSync ui={{ ...initialState.settings.ui, theme, layout }} applyLayout={false} />

      <section className="mb-8">
        <div className="mb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
            Layout
          </p>
          <h2 className="mt-2 text-lg font-medium">Pick the overall page feeling.</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {layoutNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => void pickLayout(name)}
              className="group h-full rounded-[24px] p-1 text-left transition hover:-translate-y-1"
            >
              <LayoutPreview layout={name} active={layout === name} />
            </button>
          ))}
        </div>
      </section>

      <section className="mb-4">
        <div className="mb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[rgb(var(--muted-foreground))]">
            Color
          </p>
          <h2 className="mt-2 text-lg font-medium">Choose the theme palette.</h2>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {themeNames.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => void pick(name)}
            className="group rounded-[24px] p-1 transition hover:-translate-y-1"
          >
            <ThemePreview theme={name} active={theme === name} />
          </button>
        ))}
      </div>
    </PageFrame>
  );
}

function LayoutPreview({ layout, active }: { layout: LayoutName; active: boolean }) {
  return (
    <div
      className="grid h-[340px] gap-4 rounded-[20px] p-5 text-left shadow-sm transition group-hover:shadow-xl"
      style={{
        background: "rgb(var(--panel))",
        color: "rgb(var(--foreground))",
        outline: active ? "2px solid rgb(var(--accent))" : "1px solid rgb(0 0 0 / 0.06)",
        outlineOffset: active ? "2px" : "0",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-lg">{layoutLabels[layout]}</span>
        {active ? <Check className="h-5 w-5" style={{ color: "rgb(var(--accent))" }} /> : null}
      </div>
      <p className="max-w-sm text-sm text-[rgb(var(--muted-foreground))]">
        {layoutDescriptions[layout]}
      </p>
      {layout === "chat" ? (
        <div className="grid flex-1 content-end gap-2">
          <div className="ml-auto h-9 w-24 rounded-[18px] bg-[rgb(var(--accent))] opacity-85" />
          <div className="h-9 w-4/5 rounded-[18px] bg-[rgb(var(--muted))]" />
          <div className="h-9 w-2/3 rounded-[18px] bg-[rgb(var(--panel))] border border-[rgb(var(--border))]" />
        </div>
      ) : (
        <div className="grid flex-1 content-end gap-2">
          <div className="h-8 w-1/3 rounded-[14px] bg-[rgb(var(--muted))]" />
          <div className="h-9 rounded-[18px] border border-[rgb(var(--border))] bg-[rgb(var(--panel))]" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-9 rounded-[14px] bg-[rgb(var(--muted))]/70" />
            <div className="h-9 rounded-[14px] bg-[rgb(var(--muted))]/50" />
          </div>
        </div>
      )}
    </div>
  );
}

function ThemePreview({ theme, active }: { theme: ThemeName; active: boolean }) {
  const palette = themePreviews[theme];
  return (
    <div
      className="grid gap-4 rounded-[20px] p-5 text-left shadow-sm transition group-hover:shadow-xl"
      style={{
        background: palette.bg,
        color: palette.fg,
        outline: active ? `2px solid ${palette.accent}` : "1px solid rgb(0 0 0 / 0.06)",
        outlineOffset: active ? "2px" : "0",
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-lg">{themeLabels[theme]}</span>
        {active ? <Check className="h-5 w-5" style={{ color: palette.accent }} /> : null}
      </div>
      <div className="grid gap-2">
        <div className="h-7 w-2/3 rounded-full" style={{ background: palette.muted }} />
        <div
          className="ml-auto h-9 w-1/2 rounded-[18px]"
          style={{ background: palette.panel, border: `1px solid ${palette.muted}` }}
        />
      </div>
      <div className="flex items-end justify-between">
        <pre className="font-mono text-[10px] leading-tight" style={{ color: palette.ascii }}>
{`//// AITHY ////
..::##::`}
        </pre>
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full" style={{ background: palette.accent }} />
          <span className="h-3 w-3 rounded-full" style={{ background: palette.ascii }} />
          <span className="h-3 w-3 rounded-full" style={{ background: palette.muted }} />
        </div>
      </div>
    </div>
  );
}
