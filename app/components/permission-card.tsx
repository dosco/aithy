import { useState } from "react";
import { ChevronDown, RotateCcw, ShieldAlert, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LayoutName } from "../../src/settings/types";
import type {
  SerializableBotMessage,
  SerializableSystemPermissionRequest,
} from "../../src/web/live-events";

type PermissionMessage = Extract<
  SerializableBotMessage,
  { kind: "permission" }
>;

export function PermissionCard({
  request,
  message,
  layout = "chat",
  busy = false,
  onDecision,
  onRetry,
}: {
  request?: SerializableSystemPermissionRequest;
  message?: PermissionMessage;
  layout?: LayoutName;
  busy?: boolean;
  onDecision?: (requestId: string, decision: "allow" | "deny", persist?: string) => void;
  onRetry?: (message: PermissionMessage) => void;
}) {
  const [expanded, setExpanded] = useState(!message);
  const item = message ?? request;
  if (!item) return null;
  const status = message?.status ?? request?.status ?? "pending";
  const pending = status === "pending";
  const collapsible = Boolean(message) && !pending;
  const retryable = message?.status === "timed_out" && onRetry;
  const Icon = status === "denied" ? ShieldX : ShieldAlert;
  const tone = toneClasses(status);
  const detailsId = message
    ? `permission-details-${message.requestId}`
    : request
      ? `permission-details-${request.id}`
    : undefined;

  if (layout === "work") {
    return (
    <div
      className={`app-chat-bubble-frame w-fit max-w-[min(68%,44rem)] rounded-[18px] border px-4 py-3 text-sm shadow-[0_14px_30px_rgba(24,24,27,0.08)] ${tone.card}`}
    >
      <div className="flex items-start gap-3">
        {retryable ? (
          <button
            type="button"
            aria-label="Retry expired command"
            title="Retry expired command"
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-[rgb(var(--background))] ${tone.icon}`}
            onClick={() => onRetry(message)}
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        ) : (
          <div
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${tone.icon}`}
          >
            {status === "allowed" ? (
              <span className="text-lg font-semibold leading-none">✓</span>
            ) : (
              <Icon className="h-4 w-4" />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className={`truncate text-base font-medium ${tone.title}`}>
                  {pending
                    ? permissionTitle(request)
                    : statusLabel(status)}
                </div>
              </div>
              {!expanded ? (
                <div className="mt-1 min-w-0 font-mono text-xs opacity-80">
                  <span className="inline-block max-w-full truncate align-bottom">
                    {item.command}
                  </span>
                </div>
              ) : null}
            </div>
            {collapsible ? (
              <div className="-mr-1 flex shrink-0 items-center">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  aria-label={
                    expanded
                      ? "Collapse permission details"
                      : "Expand permission details"
                  }
                  title={
                    expanded
                      ? "Collapse permission details"
                      : "Expand permission details"
                  }
                  className={`grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${tone.arrow}`}
                  onClick={() => setExpanded((value) => !value)}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                  />
                </button>
              </div>
            ) : null}
          </div>

          {expanded ? (
            <div id={detailsId}>
              <p className="mt-1 leading-6 opacity-85">
                {statusDescription(status)}
              </p>
              <dl className="mt-3 grid gap-2">
                <PermissionField label="Reason" value={item.reason} />
                {item.cwd ? <PermissionField label="Folder" value={item.cwd} mono /> : null}
                {"targetValue" in item && item.targetValue ? (
                  <PermissionField label={targetLabel(item.targetKind)} value={item.targetValue} mono />
                ) : null}
                <PermissionField
                  label={item.toolName === "system.bash" ? "Command" : "Request"}
                  value={item.command}
                  mono
                  block
                />
              </dl>
            </div>
          ) : null}

          {pending && request && onDecision ? (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="border border-amber-300 bg-amber-200 text-amber-950 shadow-sm hover:bg-amber-200 dark:border-amber-300/25 dark:bg-amber-950/45 dark:text-amber-100 dark:hover:bg-amber-900/60"
                disabled={busy}
                onClick={() => onDecision(request.id, "deny")}
              >
                Deny
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="border border-amber-300 bg-amber-300 text-amber-950 shadow-sm hover:bg-amber-400 dark:border-amber-300 dark:bg-amber-300 dark:text-amber-950 dark:hover:bg-amber-200"
                disabled={busy}
                onClick={() => onDecision(request.id, "allow")}
              >
                Allow once
              </Button>
              {request.matchOptions.map((option) => (
                <Button
                  key={option.kind}
                  type="button"
                  variant="default"
                  size="sm"
                  className="border border-emerald-300 bg-emerald-300 text-emerald-950 shadow-sm hover:bg-emerald-400 dark:border-emerald-300 dark:bg-emerald-300 dark:text-emerald-950 dark:hover:bg-emerald-200"
                  disabled={busy}
                  onClick={() => onDecision(request.id, "allow", option.kind)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
    );
  }

  const chatTone = chatToneClasses(status);
  const showDetails = pending || expanded;
  return (
    <div className="app-chat-bubble-frame w-fit max-w-[min(68%,38rem)]">
      <div className={`app-chat-bubble app-chat-bubble-assistant rounded-[12px] border px-3 py-2.5 text-sm shadow-[0_1px_2px_rgb(0_0_0/0.05)] ${chatTone.card}`}>
        <div className="flex items-start gap-2.5">
          {retryable ? (
            <button
              type="button"
              aria-label="Retry expired command"
              title="Retry expired command"
              className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--accent))]/35 ${chatTone.icon}`}
              onClick={() => onRetry(message)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${chatTone.icon}`}>
              {status === "allowed" ? (
                <span className="text-base font-semibold leading-none">✓</span>
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium leading-6">
                  {pending ? permissionTitle(request) : statusLabel(status)}
                </div>
                {!showDetails ? (
                  <div className="mt-0.5 truncate font-mono text-[11px] text-[rgb(var(--muted-foreground))]">
                    {item.command}
                  </div>
                ) : null}
              </div>
              {collapsible ? (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={detailsId}
                  aria-label={expanded ? "Collapse permission details" : "Expand permission details"}
                  title={expanded ? "Collapse permission details" : "Expand permission details"}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]"
                  onClick={() => setExpanded((value) => !value)}
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>
              ) : null}
            </div>

            {showDetails ? (
              <div id={detailsId}>
                <p className="mt-1 leading-6 text-[rgb(var(--foreground))]/85">
                  {statusDescription(status)}
                </p>
                <dl className="mt-2 grid gap-2">
                  <PermissionField label="Reason" value={item.reason} />
                  {item.cwd ? <PermissionField label="Folder" value={item.cwd} mono /> : null}
                  {"targetValue" in item && item.targetValue ? (
                    <PermissionField label={targetLabel(item.targetKind)} value={item.targetValue} mono />
                  ) : null}
                  <PermissionField
                    label={item.toolName === "system.bash" ? "Command" : "Request"}
                    value={item.command}
                    mono
                    block
                  />
                </dl>
              </div>
            ) : null}

            {pending && request && onDecision ? (
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.54)] px-2.5 text-xs text-[rgb(var(--foreground))] hover:bg-[rgb(var(--muted))]"
                  disabled={busy}
                  onClick={() => onDecision(request.id, "deny")}
                >
                  Deny
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-8 rounded-md px-2.5 text-xs"
                  disabled={busy}
                  onClick={() => onDecision(request.id, "allow")}
                >
                  Allow once
                </Button>
                {request.matchOptions.map((option) => (
                  <Button
                    key={option.kind}
                    type="button"
                    variant="soft"
                    size="sm"
                    className="h-8 rounded-md px-2.5 text-xs"
                    disabled={busy}
                    onClick={() => onDecision(request.id, "allow", option.kind)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function permissionTitle(request?: SerializableSystemPermissionRequest): string {
  if (!request) return "Allow tool request?";
  if (request.toolName === "system.bash") return "Allow command on your computer?";
  if (request.capability.startsWith("web.")) return "Allow web access?";
  if (request.capability.startsWith("memory.")) return "Allow memory write?";
  if (request.capability.startsWith("sandbox.")) return "Allow sandbox capability?";
  return "Allow tool request?";
}

function targetLabel(kind: string | null): string {
  if (kind === "host_path") return "Host path";
  if (kind === "website") return "Website";
  if (kind === "web_search") return "Search";
  if (kind === "memory") return "Memory";
  if (kind === "command") return "Target";
  return "Target";
}

function PermissionField({
  label,
  value,
  mono = false,
  block = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  block?: boolean;
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
        {label}
      </dt>
      <dd
        className={`${mono ? "font-mono text-xs" : ""} ${block ? "whitespace-pre-wrap break-all" : "break-words"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === "allowed") return "Command approved once";
  if (status === "timed_out") return "Command expired";
  return "Command denied";
}

function statusDescription(status: string): string {
  if (status === "allowed") return "Approved once and recorded for audit.";
  if (status === "denied") return "This command was denied and did not run.";
  if (status === "timed_out")
    return "This command was not approved before the request expired.";
  return "This command runs on your computer, outside the sandbox.";
}

function toneClasses(status: string) {
  if (status === "allowed") {
    return {
      card: "border-emerald-700 bg-emerald-600 text-white dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-100",
      icon: "bg-emerald-800 text-white dark:bg-emerald-900 dark:text-emerald-100",
      title: "text-white dark:text-emerald-100",
      arrow: "text-white dark:text-emerald-100",
    };
  }
  if (status === "denied") {
    return {
      card: "border-stone-200 bg-white/95 text-stone-950 dark:border-rose-800/70 dark:bg-stone-950/80 dark:text-stone-100",
      icon: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
      title: "text-rose-800 dark:text-rose-100",
      arrow: "text-stone-600 dark:text-stone-300",
    };
  }
  return {
    card: "border-amber-400 bg-amber-100 text-amber-950 shadow-[0_16px_34px_rgba(120,53,15,0.12)] dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100",
    icon: "bg-amber-300 text-amber-950 dark:bg-amber-900 dark:text-amber-100",
    title: "text-amber-950 dark:text-amber-100",
    arrow: "text-amber-950 dark:text-amber-100",
  };
}

function chatToneClasses(status: string) {
  if (status === "allowed") {
    return {
      card: "border-[rgb(var(--accent)/0.28)] bg-[rgb(var(--bubble-bot))] text-[rgb(var(--foreground))]",
      icon: "bg-[rgb(var(--accent)/0.14)] text-[rgb(var(--accent))]",
    };
  }
  if (status === "denied") {
    return {
      card: "border-[rgb(var(--danger)/0.32)] bg-[rgb(var(--danger)/0.08)] text-[rgb(var(--foreground))]",
      icon: "bg-[rgb(var(--danger)/0.12)] text-[rgb(var(--danger))]",
    };
  }
  return {
    card: "border-amber-500/35 bg-amber-100/70 text-amber-950 dark:bg-amber-950/22 dark:text-amber-100",
    icon: "bg-amber-300/70 text-amber-950 dark:bg-amber-900/70 dark:text-amber-100",
  };
}
