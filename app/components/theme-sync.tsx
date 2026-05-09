import { useEffect } from "react";
import type { UiPreferences } from "../../src/settings/types";

export function ThemeSync({
  ui,
  applyLayout = true,
}: {
  ui: UiPreferences;
  applyLayout?: boolean;
}) {
  useEffect(() => {
    const apply = () => {
      let stored: Partial<UiPreferences> = {};
      try {
        stored = JSON.parse(window.localStorage.getItem("aithy-theme") || "{}") as Partial<UiPreferences>;
      } catch {}
      // Keep the active UI state authoritative, but preserve any cached values
      // that are not explicitly provided by the current render.
      const next = { ...stored, ...ui };
      const dark = next.colorMode === "dark"
          || (next.colorMode === "system"
          && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dataset.theme = next.theme;
      if (applyLayout) {
        document.documentElement.dataset.layout = next.layout;
      }
      window.localStorage.setItem("aithy-theme", JSON.stringify(next));
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [applyLayout, ui]);

  return null;
}
