import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GlobalMountsSection } from "../app/components/settings-global-mounts";
import {
  ApiKeyInput,
  ModelCombobox,
  fieldClass,
  selectClass,
} from "../app/components/settings-form-bits";
import { Button } from "../app/components/ui/button";
import { Input } from "../app/components/ui/input";
import { Switch } from "../app/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "../app/components/ui/tabs";
import { Textarea } from "../app/components/ui/textarea";

describe("shared control contrast classes", () => {
  test("buttons use explicit token colors for each variant and disabled state", () => {
    const html = renderToStaticMarkup(React.createElement("div", null,
      React.createElement(Button, null, "Default"),
      React.createElement(Button, { variant: "soft" }, "Soft"),
      React.createElement(Button, { variant: "ghost" }, "Ghost"),
      React.createElement(Button, { variant: "danger", disabled: true }, "Danger"),
    ));

    expect(html).toContain("bg-[rgb(var(--accent))]");
    expect(html).toContain("text-[rgb(var(--accent-foreground))]");
    expect(html).toContain("bg-[rgb(var(--muted))]");
    expect(html).toContain("text-[rgb(var(--foreground))]");
    expect(html).toContain("text-[rgb(var(--muted-foreground))]");
    expect(html).toContain("text-[rgb(var(--danger))]");
    expect(html).toContain("disabled:bg-[rgb(var(--muted))]/50");
    expect(html).not.toContain("disabled:opacity-50");
  });

  test("shared inputs and textareas include foreground, caret, and disabled/read-only contrast", () => {
    const html = renderToStaticMarkup(React.createElement("div", null,
      React.createElement(Input, { readOnly: true, value: "readable" }),
      React.createElement(Textarea, { disabled: true, value: "readable" }),
    ));

    expect(html).toContain("text-[rgb(var(--foreground))]");
    expect(html).toContain("caret-[rgb(var(--foreground))]");
    expect(html).toContain("read-only:bg-[rgb(var(--muted))]/35");
    expect(html).toContain("disabled:bg-[rgb(var(--muted))]/50");
    expect(html).toContain("disabled:text-[rgb(var(--muted-foreground))]");
  });

  test("settings form helpers keep native and composite controls readable", () => {
    const html = renderToStaticMarkup(React.createElement("div", null,
      React.createElement("input", { className: fieldClass, readOnly: true, value: "resolved" }),
      React.createElement("select", { className: selectClass, value: "none", onChange: () => {} },
        React.createElement("option", { value: "none" }, "none"),
      ),
      React.createElement(ApiKeyInput, {
        value: "",
        onChange: () => {},
        secret: null,
        disabled: true,
        fallback: "No key needed",
      }),
      React.createElement(ModelCombobox, {
        provider: "openai",
        value: "gpt-4.1",
        onChange: () => {},
        disabled: true,
        modelOptions: ["gpt-4.1"],
      }),
    ));

    expect(fieldClass).toContain("text-[rgb(var(--foreground))]");
    expect(fieldClass).toContain("caret-[rgb(var(--foreground))]");
    expect(selectClass).toContain("[&>option]:text-[rgb(var(--foreground))]");
    expect(html).toContain("bg-[rgb(var(--muted))]/35");
    expect(html).toContain("disabled:text-[rgb(var(--muted-foreground))]");
  });

  test("tabs, switches, and global mount controls inherit dark-safe shared styling", () => {
    const html = renderToStaticMarkup(React.createElement("div", null,
      React.createElement(Tabs, { defaultValue: "sandbox" },
        React.createElement(TabsList, null,
          React.createElement(TabsTrigger, { value: "sandbox" }, "Sandbox"),
        ),
      ),
      React.createElement(Switch, { checked: true }),
      React.createElement(GlobalMountsSection, {
        mounts: [{ hostPath: "/tmp/project" }],
        skippedPaths: [],
        onChange: () => {},
      }),
    ));

    expect(html).toContain("data-[state=active]:bg-[rgb(var(--accent))]");
    expect(html).toContain("data-[state=checked]:bg-[rgb(var(--accent))]");
    expect(html).toContain("data-[state=checked]:bg-[rgb(var(--accent-foreground))]");
    expect(html).toContain("Add path");
    expect(html).toContain("hover:text-[rgb(var(--foreground))]");
  });

  test("dark graphite overrides the light muted surface token", () => {
    const css = readFileSync("app/styles/app.css", "utf8");
    const match = css.match(/\.dark\[data-theme="graphite"\]\s*{(?<body>[^}]+)}/);

    expect(match?.groups?.body).toContain("--muted:");
    expect(match?.groups?.body).toContain("--muted-foreground:");
  });

  test("named dark themes keep core control token pairs readable", () => {
    const css = readFileSync("app/styles/app.css", "utf8");
    const themes = {
      paper: { ...cssVars(css, ":root"), ...cssVars(css, ".dark") },
      graphite: darkThemeVars(css, "[data-theme=\"graphite\"]", ".dark[data-theme=\"graphite\"]"),
      noir: darkThemeVars(css, "[data-theme=\"noir\"]", ".dark[data-theme=\"noir\"]"),
    };
    const pairs = [
      ["foreground", "muted"],
      ["foreground", "panel"],
      ["muted-foreground", "background"],
      ["accent-foreground", "accent"],
      ["danger", "background"],
    ] as const;

    for (const tokens of Object.values(themes)) {
      for (const [foreground, background] of pairs) {
        expect(contrast(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

function darkThemeVars(css: string, lightSelector: string, darkSelector: string): Record<string, Rgb> {
  return {
    ...cssVars(css, ":root"),
    ...cssVars(css, ".dark"),
    ...cssVars(css, lightSelector),
    ...cssVars(css, darkSelector),
  };
}

function cssVars(css: string, selector: string): Record<string, Rgb> {
  const match = css.match(new RegExp(`${escapeRegExp(selector)}\\s*{(?<body>[^}]+)}`));
  if (!match?.groups?.body) throw new Error(`Missing CSS selector: ${selector}`);
  return Object.fromEntries(
    [...match.groups.body.matchAll(/--([a-z-]+):\s*([^;]+);/g)]
      .map((entry) => [entry[1], parseRgbVar(entry[2])]),
  );
}

type Rgb = [number, number, number];

function parseRgbVar(value: string): Rgb {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Expected RGB token, got ${value}`);
  }
  return parts as Rgb;
}

function contrast(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(rgb: Rgb): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
