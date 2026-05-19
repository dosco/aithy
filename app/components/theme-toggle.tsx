import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { saveSettingsWithSetupGateRefresh } from "@/lib/setup-gate";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  async function flip() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      const stored = JSON.parse(window.localStorage.getItem("aithy-theme") || "{}");
      window.localStorage.setItem(
        "aithy-theme",
        JSON.stringify({ ...stored, colorMode: next ? "dark" : "light" }),
      );
    } catch {}
    await saveSettingsWithSetupGateRefresh({ data: { ui: { colorMode: next ? "dark" : "light" } } });
  }

  return (
    <button
      onClick={() => void flip()}
      aria-label="Toggle dark mode"
      aria-pressed={dark}
      className={cn("app-top-icon", dark && "app-top-icon-active")}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
