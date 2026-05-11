import { useState } from "react";
import type { ReactNode } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { CONFIRM_TEXT, ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deleteAllSessions,
  resetMemories,
  resetSystemOptions,
} from "@/server/actions.functions";
import { setCachedSetupGateState } from "@/lib/setup-gate";
import type { WebStateDto } from "@/server/dto";

type DangerAction = "sessions" | "memories" | "system";

export function SettingsDangerZone({ onSystemReset }: { onSystemReset: (state: WebStateDto) => void }) {
  const [dangerAction, setDangerAction] = useState<DangerAction | null>(null);
  const [dangerBusy, setDangerBusy] = useState(false);
  const [dangerSaved, setDangerSaved] = useState<string | null>(null);

  async function runDangerAction(action: DangerAction) {
    setDangerBusy(true);
    try {
      if (action === "sessions") {
        await deleteAllSessions({ data: { confirmation: CONFIRM_TEXT } });
        setDangerSaved("Sessions deleted");
      } else if (action === "memories") {
        await resetMemories({ data: { confirmation: CONFIRM_TEXT } });
        setDangerSaved("Memories reset");
      } else {
        const state = await resetSystemOptions({ data: { confirmation: CONFIRM_TEXT } });
        setCachedSetupGateState({
          aiConfigured: state.aiConfigured,
          profileConfigured: Boolean(state.profile.userName.trim()),
        });
        onSystemReset(state);
        setDangerSaved("System reset");
      }
      setTimeout(() => setDangerSaved(null), 1800);
    } finally {
      setDangerBusy(false);
      setDangerAction(null);
    }
  }

  return (
    <>
      <Section
        title="Danger zone"
        subtitle={`These actions require typing ${CONFIRM_TEXT}. They cannot be undone.`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Button type="button" variant="danger" onClick={() => setDangerAction("sessions")}>
            <Trash2 className="h-4 w-4" />
            Delete all sessions
          </Button>
          <Button type="button" variant="danger" onClick={() => setDangerAction("memories")}>
            <Trash2 className="h-4 w-4" />
            Reset memories
          </Button>
          <Button type="button" variant="danger" onClick={() => setDangerAction("system")}>
            <RotateCcw className="h-4 w-4" />
            Reset system options
          </Button>
        </div>
        {dangerSaved ? (
          <p className="text-sm text-[rgb(var(--muted-foreground))]">{dangerSaved}</p>
        ) : null}
      </Section>
      <ConfirmDialog
        open={dangerAction !== null}
        title={dangerCopy(dangerAction).title}
        body={dangerCopy(dangerAction).body}
        confirmLabel={dangerCopy(dangerAction).confirmLabel}
        requireTypedConfirmation
        busy={dangerBusy}
        onCancel={() => setDangerAction(null)}
        onConfirm={() => {
          if (dangerAction) void runDangerAction(dangerAction);
        }}
      />
    </>
  );
}

function dangerCopy(action: DangerAction | null) {
  if (action === "sessions") {
    return {
      title: "Delete all sessions?",
      body: "This deletes every conversation, sub-session, and related task record. Active runs will be stopped.",
      confirmLabel: "Delete sessions",
    };
  }
  if (action === "memories") {
    return {
      title: "Reset memories?",
      body: "This removes every stored memory, memory index row, and memory task run.",
      confirmLabel: "Reset memories",
    };
  }
  return {
    title: "Reset system options?",
    body: "This stops active work, recreates the SQLite databases, clears app-managed provider secrets, and resets all SQLite-backed app data.",
    confirmLabel: "Reset system",
  };
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("grid gap-4 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))]/40 p-5")}>
      <header className="grid gap-1">
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
        {subtitle ? (
          <p className="text-xs text-[rgb(var(--muted-foreground))]">{subtitle}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}
