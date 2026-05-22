import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SettingsSaveBar({
  saved,
  saveBusy,
  onSave,
  disabled,
  label = "Save settings",
  busyLabel = "Testing...",
  savedLabel = "Saved",
}: {
  saved: boolean;
  saveBusy: boolean;
  onSave: () => void;
  disabled?: boolean;
  label?: string;
  busyLabel?: string;
  savedLabel?: string;
}) {
  return (
    <div className="pointer-events-none fixed left-0 right-0 top-20 z-20 px-4 sm:px-8">
      <div className="app-shell-main mx-auto flex justify-end">
        <Button
          onClick={onSave}
          disabled={saveBusy || disabled}
          className="pointer-events-auto shadow-[0_8px_24px_rgb(0_0_0/0.12)] sm:min-w-[140px]"
        >
          {saved ? <Check className="h-4 w-4" /> : null}
          {saveBusy ? busyLabel : saved ? savedLabel : label}
        </Button>
      </div>
    </div>
  );
}
