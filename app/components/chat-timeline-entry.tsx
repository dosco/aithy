import { useReducedMotion, motion, type HTMLMotionProps } from "framer-motion";
import { GitBranch, LoaderCircle, RotateCcw } from "lucide-react";
import { ArtifactCard } from "@/components/artifact-card";
import { Markdown } from "@/components/markdown";
import { PermissionCard } from "@/components/permission-card";
import { ClarificationControls } from "@/components/clarification-controls";
import { ChatFeedbackControls } from "@/components/chat-feedback-controls";
import type { LayoutName } from "../../src/settings/types";
import type { SessionSummaryDto } from "@/server/dto";
import type {
  SerializableBotMessage,
  SerializableSystemPermissionRequest,
} from "../../src/web/live-events";

type Usage = { input: number; output: number; thought: number; total: number };
type AssistantTextStatus = Extract<SerializableBotMessage, { kind: "text" }>["status"];
export type WorkingLabel =
  | "Thinking"
  | "Searching"
  | "Reading"
  | "Coding"
  | "Running"
  | "Waiting for approval"
  | "Sending";

export type TimelineEntry =
  | { kind: "day-divider"; key: string; label: string }
  | { kind: "user"; key: string; content: string }
  | {
      kind: "assistant";
      key: string;
      content: string;
      status?: AssistantTextStatus;
      retryTaskId?: string;
      retrying?: boolean;
      retryDisabled?: boolean;
      usage?: Usage;
      clarification?: Extract<SerializableBotMessage, { kind: "text" }>["clarification"];
      clarificationInteractive?: boolean;
      feedback?: { sessionId: string; messageId: number };
    }
  | { kind: "artifact"; key: string; message: Extract<SerializableBotMessage, { kind: "artifact" }> }
  | { kind: "permission"; key: string; message: Extract<SerializableBotMessage, { kind: "permission" }> }
  | { kind: "permission-request"; key: string; request: SerializableSystemPermissionRequest }
  | { kind: "thought"; key: string; content: string }
  | { kind: "tool"; key: string; toolName: string; toolArgs: unknown; toolResult?: unknown; usage?: Usage }
  | { kind: "sub-session"; key: string; session: SessionSummaryDto }
  | { kind: "activity"; key: string; label: string }
  | { kind: "typing"; key: string; label: WorkingLabel; detail?: string };

export function TimelineItem({
  item,
  layout,
  onOpenSession,
  onPermissionDecision,
  onPermissionRetry,
  onRetryTask,
  onClarificationSubmit,
}: {
  item: Exclude<TimelineEntry, { kind: "typing" }>;
  layout: LayoutName;
  onOpenSession: (session: SessionSummaryDto) => void;
  onPermissionDecision: (requestId: string, decision: "allow" | "deny", persist?: string) => void;
  onPermissionRetry: (message: Extract<SerializableBotMessage, { kind: "permission" }>) => void;
  onRetryTask: (taskId: string) => void;
  onClarificationSubmit: (text: string) => void;
}) {
  const reduce = useReducedMotion();
  const motionProps: HTMLMotionProps<"div"> = reduce
    ? {}
    : {
        layout: true,
        initial: { opacity: 0, y: 8, scale: 0.99 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, transition: { duration: 0.12 } },
        transition: { type: "spring" as const, stiffness: 360, damping: 32 },
      };

  if (item.kind === "day-divider") {
    return (
      <motion.div
        {...motionProps}
        className="flex w-full items-center gap-3 py-1.5 text-[rgb(var(--muted-foreground)/0.7)]"
      >
        <span className="h-px flex-1 bg-[rgb(var(--border)/0.55)]" />
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em]">
          {item.label}
        </span>
        <span className="h-px flex-1 bg-[rgb(var(--border)/0.55)]" />
      </motion.div>
    );
  }
  if (item.kind === "user") {
    return (
      <motion.div
        {...motionProps}
        className="app-chat-bubble app-chat-bubble-user ml-auto w-fit max-w-[min(58%,32rem)] rounded-[10px] bg-[rgb(var(--foreground))] px-4 py-2 text-[0.96rem] leading-7 text-[rgb(var(--background))]"
      >
        <Markdown text={item.content} />
      </motion.div>
    );
  }
  if (item.kind === "assistant") {
    const error = isAssistantError(item);
    const content = error ? assistantErrorText(item.content) : item.content;
    const bubbleClass = [
      "app-chat-bubble app-chat-bubble-assistant rounded-[12px] px-4 py-2 text-[0.98rem] leading-7 shadow-[0_1px_2px_rgb(0_0_0/0.05)]",
      error ? "app-chat-bubble-error" : "bg-[rgb(var(--bubble-bot))]",
    ].join(" ");
    return (
      <motion.div {...motionProps} className="app-chat-bubble-frame w-fit max-w-[min(62%,36rem)]">
        <div className={bubbleClass}>
          {item.retryTaskId ? (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Markdown text={content} />
              </div>
              <button
                type="button"
                onClick={() => item.retryTaskId && onRetryTask(item.retryTaskId)}
                disabled={item.retrying || item.retryDisabled}
                aria-label="Retry failed message"
                title={item.retryDisabled ? "Retry after the current reply finishes" : "Retry failed message"}
                className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[rgb(var(--danger))] transition hover:bg-[rgb(var(--danger)/0.12)] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--danger))]/35 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {item.retrying
                  ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  : <RotateCcw className="h-3.5 w-3.5" />}
              </button>
            </div>
          ) : (
            <Markdown text={content} />
          )}
        </div>
        {item.usage ? <UsageLine usage={item.usage} /> : null}
        {item.clarification && item.clarificationInteractive
          ? <ClarificationControls clarification={item.clarification} onSubmit={onClarificationSubmit} />
          : null}
        {item.feedback && item.status !== "failed" && item.status !== "cancelled"
          ? <ChatFeedbackControls sessionId={item.feedback.sessionId} messageId={item.feedback.messageId} /> : null}
      </motion.div>
    );
  }
  if (item.kind === "thought") {
    return (
      <motion.div {...motionProps} className="app-chat-bubble-frame w-fit max-w-[min(62%,36rem)]">
        <details className="rounded-lg border border-dashed border-[rgb(var(--border)/0.45)] bg-[rgb(var(--panel)/0.42)] px-3 py-2 text-sm text-[rgb(var(--muted-foreground))]">
          <summary className="cursor-pointer select-none font-mono text-[10px] uppercase tracking-[0.18em]">
            thinking
          </summary>
          <div className="mt-2 whitespace-pre-wrap leading-6 [overflow-wrap:anywhere]">{item.content}</div>
        </details>
      </motion.div>
    );
  }
  if (item.kind === "permission") {
    return <motion.div {...motionProps}><PermissionCard layout={layout} message={item.message} onRetry={onPermissionRetry} /></motion.div>;
  }
  if (item.kind === "permission-request") {
    return <motion.div {...motionProps}><PermissionCard layout={layout} request={item.request} onDecision={onPermissionDecision} /></motion.div>;
  }
  if (item.kind === "artifact") return <motion.div {...motionProps}><ArtifactCard layout={layout} artifact={item.message} /></motion.div>;
  if (item.kind === "tool") return <ToolEntry item={item} motionProps={motionProps} />;
  if (item.kind === "sub-session") {
    return (
      <motion.div
        {...motionProps}
        className="app-chat-bubble-frame flex w-fit max-w-[min(62%,36rem)] items-center gap-3 rounded-lg border border-[rgb(var(--border)/0.45)] bg-[rgb(var(--panel))] px-3 py-2 shadow-[0_1px_2px_rgb(0_0_0/0.05)]"
      >
        <button
          type="button"
          onClick={() => onOpenSession(item.session)}
          aria-label={`Open sub-session ${item.session.name}`}
          title="Open sub-session"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[rgb(var(--foreground))] text-[rgb(var(--background))] transition hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))] focus:ring-offset-2 focus:ring-offset-[rgb(var(--background))]"
        >
          <GitBranch className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onOpenSession(item.session)}
          className="min-w-0 text-left"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
            sub-session
          </div>
          <div className="truncate text-sm font-medium">{item.session.name}</div>
        </button>
      </motion.div>
    );
  }
  return (
    <motion.div
      {...motionProps}
      className="app-chat-bubble-frame max-w-[66%] font-mono text-xs text-[rgb(var(--muted-foreground))]"
    >
      · {item.label}
    </motion.div>
  );
}

export function WorkingIndicator({ label, detail }: { label: WorkingLabel; detail?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="app-chat-bubble-frame w-fit max-w-[min(62%,24rem)]"
      aria-label={`Assistant is ${label.toLowerCase()}`}
    >
      <div className="app-chat-bubble app-chat-bubble-assistant rounded-[12px] bg-[rgb(var(--bubble-bot)/0.72)] px-3 py-2 text-sm text-[rgb(var(--muted-foreground))] shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
        <div className="flex items-center gap-2">
          <span>{label}</span>
          <span className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="block h-1.5 w-1.5 rounded-full bg-[rgb(var(--muted-foreground))]"
              animate={reduce ? undefined : { y: [0, -3, 0], opacity: [0.35, 0.8, 0.35] }}
              transition={
                reduce
                  ? undefined
                  : { duration: 1, ease: "easeInOut", repeat: Infinity, delay: i * 0.15 }
              }
            />
          ))}
          </span>
        </div>
        {detail ? <div className="mt-1 max-w-[22rem] text-xs leading-5 opacity-80">{detail}</div> : null}
      </div>
    </motion.div>
  );
}

export function displayToolName(toolName: string | undefined, toolArgs: unknown): string {
  if (toolName?.trim()) return toolName;
  if (hasKeys(toolArgs, ["query", "task"])) return "web.search";
  if (hasKeys(toolArgs, ["url"])) return "web.fetch";
  if (hasKeys(toolArgs, ["queries", "excludeIds"])) return "memory.recall";
  if (hasKeys(toolArgs, ["queries"])) return "skills.search";
  if (hasKeys(toolArgs, ["command"])) return "sandbox.bash";
  return "unknown";
}

function ToolEntry({
  item,
  motionProps,
}: {
  item: Extract<TimelineEntry, { kind: "tool" }>;
  motionProps: HTMLMotionProps<"div">;
}) {
  return (
    <motion.div
      {...motionProps}
      className="app-chat-bubble-frame w-fit max-w-[min(62%,36rem)]"
    >
      <details className="rounded-lg border border-[rgb(var(--border)/0.4)] bg-[rgb(var(--panel)/0.48)] px-3 py-2 font-mono text-xs leading-6 text-[rgb(var(--muted-foreground))]">
        <summary className="cursor-pointer select-none font-sans text-[10px] uppercase tracking-[0.18em]">
          tool · {item.toolName}
        </summary>
        <div className="mt-2 overflow-x-auto whitespace-pre-wrap break-all">
          {JSON.stringify(item.toolArgs, null, 2)}
        </div>
        {item.toolResult === undefined ? null : (
          <>
            <div className="mb-1 mt-3 font-sans text-[10px] uppercase tracking-[0.18em]">result</div>
            <div className="overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(item.toolResult, null, 2)}
            </div>
          </>
        )}
        {item.usage ? <UsageLine usage={item.usage} /> : null}
      </details>
    </motion.div>
  );
}

function UsageLine({ usage }: { usage: Usage }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[rgb(var(--muted-foreground))]">
      <span>in {usage.input}</span>
      <span>out {usage.output}</span>
      {usage.thought ? <span>thought {usage.thought}</span> : null}
      <span>· {usage.total} total</span>
    </div>
  );
}

function isAssistantError(item: Extract<TimelineEntry, { kind: "assistant" }>): boolean {
  if (item.status === "failed") return true;
  const text = item.content.trim();
  return text.startsWith("Error:") || text === "Unknown error";
}

function assistantErrorText(content: string): string {
  let text = content.trim();
  while (/^(?:Error|[A-Za-z][A-Za-z -]* Error):\s*/.test(text)) {
    text = text.replace(/^(?:Error|[A-Za-z][A-Za-z -]* Error):\s*/, "").trim();
  }
  if (text.toLowerCase() === "unknown error") return "Something went wrong.";
  return text || "Something went wrong.";
}

function hasKeys(value: unknown, keys: string[]): boolean {
  if (!value || typeof value !== "object") return false;
  return keys.every((key) => key in value);
}
