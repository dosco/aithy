import type { ColorMode, LayoutName, ThemeName } from "../../src/settings/types";

export const themeNames: ThemeName[] = [
  "paper",
  "graphite",
  "violet-ascii",
  "terminal-glow",
  "sunrise",
  "ocean",
  "matcha",
  "rose-quartz",
  "noir",
  "amber",
];

export const colorModes: ColorMode[] = ["light", "dark", "system"];
export const layoutNames: LayoutName[] = ["chat", "work"];

export const themeLabels: Record<ThemeName, string> = {
  paper: "Paper",
  graphite: "Graphite",
  "violet-ascii": "Violet ASCII",
  "terminal-glow": "Terminal Glow",
  sunrise: "Sunrise",
  ocean: "Ocean",
  matcha: "Matcha",
  "rose-quartz": "Rose Quartz",
  noir: "Noir",
  amber: "Amber",
};

export const modeLabels: Record<ColorMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export const layoutLabels: Record<LayoutName, string> = {
  chat: "Chat",
  work: "Work",
};

export const layoutDescriptions: Record<LayoutName, string> = {
  chat: "Rounder, friendlier, more conversational.",
  work: "Tighter, calmer, more like an ops dashboard.",
};

export interface ThemeSwatch {
  bg: string;
  fg: string;
  panel: string;
  muted: string;
  accent: string;
  ascii: string;
}

export const themePreviews: Record<ThemeName, ThemeSwatch> = {
  paper: { bg: "#f8f7f4", fg: "#101010", panel: "#fffffc", muted: "#ebeae6", accent: "#0a24ff", ascii: "#9a58ff" },
  graphite: { bg: "#eeeeeb", fg: "#111212", panel: "#fafaf7", muted: "#e0e0dc", accent: "#222222", ascii: "#565656" },
  "violet-ascii": { bg: "#faf7ff", fg: "#130d1e", panel: "#fffcff", muted: "#efe7ff", accent: "#9655ff", ascii: "#a45cff" },
  "terminal-glow": { bg: "#0a140e", fg: "#dcffec", panel: "#0d1a14", muted: "#13241a", accent: "#5affa5", ascii: "#50ffa0" },
  sunrise: { bg: "#fff5ec", fg: "#3a1a0a", panel: "#fffaf3", muted: "#ffe1c8", accent: "#ff7a3d", ascii: "#ff9358" },
  ocean: { bg: "#eef7fb", fg: "#0a2230", panel: "#f7fbfd", muted: "#d2e9f3", accent: "#0a7aa8", ascii: "#1a9bd0" },
  matcha: { bg: "#f3f7ec", fg: "#1a2810", panel: "#fafdf3", muted: "#dde9c8", accent: "#5a8a32", ascii: "#7aac4f" },
  "rose-quartz": { bg: "#fef0f3", fg: "#3a1224", panel: "#fff7f9", muted: "#fcd9e1", accent: "#d8527a", ascii: "#e87aa0" },
  noir: { bg: "#000000", fg: "#ffffff", panel: "#0c0c0c", muted: "#1a1a1a", accent: "#ffffff", ascii: "#cccccc" },
  amber: { bg: "#fdf6e3", fg: "#3a2a08", panel: "#fffaec", muted: "#f3e3b8", accent: "#c98a1a", ascii: "#d8a02c" },
};
