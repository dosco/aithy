import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageFrame } from "@/components/page-frame";
import { ThemeSync } from "@/components/theme-sync";
import { Button } from "@/components/ui/button";
import { deleteSession } from "@/server/actions.functions";
import type { SessionsPageStateDto } from "@/server/dto";

export function SessionsPage({ initialState }: { initialState: SessionsPageStateDto }) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState(initialState.sessions);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function open(id: string) {
    void navigate({ to: "/chat/$sessionId", params: { sessionId: id } });
  }

  async function remove(id: string) {
    setDeleting(true);
    try {
      const result = await deleteSession({ data: { conversationId: id } });
      setSessions(result.sessions);
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  const deleteTarget = sessions.find((session) => session.conversationId === pendingDelete);

  return (
    <PageFrame eyebrow="Memory" title="Saved sessions without the sidebar ceremony.">
      <ThemeSync ui={initialState.settings.ui} />
      {sessions.length === 0 ? (
        <div className="app-session-empty rounded-[24px] border border-[rgb(var(--border))] p-8 text-[rgb(var(--muted-foreground))]">
          No sessions yet.
        </div>
      ) : (
        <div className="app-sessions-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <div
              key={session.conversationId}
              onClick={() => open(session.conversationId)}
              className="app-session-card group flex cursor-pointer flex-col gap-3 rounded-[20px] border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.6)] p-4 transition hover:-translate-y-0.5 hover:bg-[rgb(var(--panel)/0.9)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-base">{session.name}</div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Delete ${session.name}`}
                  className="h-8 w-8 shrink-0 opacity-70 hover:text-red-700 group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingDelete(session.conversationId);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center justify-between font-mono text-xs text-[rgb(var(--muted-foreground))]">
                <span>{new Date(session.updatedAt).toLocaleDateString()}</span>
                <span>{session.tokenTotals.total} tokens</span>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete session?"
        body={`Delete "${deleteTarget?.name ?? "this session"}" and any related task sessions. Active work in this session will be stopped.`}
        confirmLabel="Delete session"
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void remove(pendingDelete);
        }}
      />
    </PageFrame>
  );
}
