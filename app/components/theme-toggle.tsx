import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { saveSettings } from "@/server/actions.functions";

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
    await saveSettings({ data: { ui: { colorMode: next ? "dark" : "light" } } });
  }

  return (
    <button
      onClick={() => void flip()}
      aria-label="Toggle dark mode"
      className="flex h-8 w-8 items-center justify-center rounded-full transition hover:bg-[rgb(var(--muted))]"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
