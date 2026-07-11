import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { saveChatFeedback } from "@/server/actions.functions";

export function ChatFeedbackControls({ sessionId, messageId }: { sessionId: string; messageId: number }) {
  const [verdict, setVerdict] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(nextVerdict: "up" | "down", nextComment = comment) {
    setVerdict(nextVerdict); setBusy(true);
    try { await saveChatFeedback({ data: { sessionId, messageId, verdict: nextVerdict, comment: nextComment || null } }); }
    finally { setBusy(false); }
  }
  return <div className="mt-1.5 grid gap-2">
    <div className="flex gap-1 text-[rgb(var(--muted-foreground))]">
      <button type="button" aria-label="Helpful response" title="Helpful" disabled={busy} onClick={() => void save("up")}
        className={`rounded-md p-1.5 hover:bg-[rgb(var(--muted))] ${verdict === "up" ? "text-[rgb(var(--foreground))]" : ""}`}><ThumbsUp className="h-3.5 w-3.5" /></button>
      <button type="button" aria-label="Unhelpful response" title="Unhelpful" disabled={busy} onClick={() => void save("down")}
        className={`rounded-md p-1.5 hover:bg-[rgb(var(--muted))] ${verdict === "down" ? "text-[rgb(var(--foreground))]" : ""}`}><ThumbsDown className="h-3.5 w-3.5" /></button>
    </div>
    {verdict ? <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void save(verdict); }}>
      <input value={comment} maxLength={4000} onChange={(event) => setComment(event.target.value)}
        className="min-w-0 flex-1 rounded-md border border-[rgb(var(--border))] bg-transparent px-2 py-1 text-xs" placeholder="Optional comment" />
      <button type="submit" disabled={busy} className="rounded-md px-2 text-xs text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--muted))]">Save</button>
    </form> : null}
  </div>;
}
