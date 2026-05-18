import { AnimatePresence, motion } from "framer-motion";
import { Pencil, Trash2 } from "lucide-react";
import type { PendingChatMessage } from "@/components/pending-chat-queue-state";

export function PendingChatQueue({
  messages,
  onEdit,
  onDelete,
}: {
  messages: PendingChatMessage[];
  onEdit: (message: PendingChatMessage) => void;
  onDelete: (message: PendingChatMessage) => void;
}) {
  if (messages.length === 0) return null;
  return (
    <div className="mb-2 flex flex-col items-end gap-2" aria-label="Queued follow-up messages">
      <AnimatePresence initial={false}>
        {messages.map((message) => (
          <motion.div
            key={message.id}
            layout
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 360, damping: 32 }}
            className="ml-auto w-fit max-w-[min(72%,34rem)] rounded-[10px] border border-[rgb(var(--border)/0.48)] bg-[rgb(var(--panel)/0.72)] px-3 py-2 text-sm text-[rgb(var(--foreground))] shadow-[0_1px_2px_rgb(0_0_0/0.04)] backdrop-blur"
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="min-w-0">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
                  Queued
                </div>
                <div className="whitespace-pre-wrap break-words leading-5 text-[rgb(var(--foreground))]/88">
                  {message.text}
                </div>
                {message.skills.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {message.skills.map((skill) => (
                      <span
                        key={skill.id}
                        className="max-w-full truncate rounded border border-[rgb(var(--border)/0.5)] px-1.5 py-0.5 text-[10px] text-[rgb(var(--muted-foreground))]"
                      >
                        {skill.name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => onEdit(message)}
                  aria-label="Edit queued message"
                  title="Edit queued message"
                  className="grid h-7 w-7 place-items-center rounded-md text-[rgb(var(--muted-foreground))] transition hover:bg-[rgb(var(--muted))]/70 hover:text-[rgb(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))]/35"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(message)}
                  aria-label="Delete queued message"
                  title="Delete queued message"
                  className="grid h-7 w-7 place-items-center rounded-md text-[rgb(var(--muted-foreground))] transition hover:bg-[rgb(var(--danger)/0.09)] hover:text-[rgb(var(--danger))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))]/35"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
