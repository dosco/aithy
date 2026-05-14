import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  SerializableBotMessage,
  SerializableSystemPermissionRequest,
} from "../../src/web/live-events";

type PermissionMessage = Extract<SerializableBotMessage, { kind: "permission" }>;

export function PermissionCard({
  request,
  message,
  busy = false,
  onDecision,
}: {
  request?: SerializableSystemPermissionRequest;
  message?: PermissionMessage;
  busy?: boolean;
  onDecision?: (requestId: string, decision: "allow" | "deny") => void;
}) {
  const item = message ?? request;
  if (!item) return null;
  const status = message?.status ?? request?.status ?? "pending";
  const pending = status === "pending";
  const Icon = status === "allowed" ? ShieldCheck : status === "denied" ? ShieldX : ShieldAlert;
  const tone = toneClasses(status);

  return (
    <div className={`app-chat-bubble-frame w-fit max-w-[min(78%,50rem)] rounded-[18px] border px-5 py-4 text-sm shadow-[0_14px_36px_rgba(80,52,14,0.10)] ${tone.card}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone.icon}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-base font-medium">
              {pending ? "Allow host command?" : statusLabel(status)}
            </div>
            <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ${tone.pill}`}>
              {item.toolName}
            </span>
          </div>
          <p className="mt-1 leading-6 opacity-85">
            {statusDescription(status)}
          </p>
          <dl className="mt-3 grid gap-2">
            <PermissionField label="Reason" value={item.reason} />
            <PermissionField label="Cwd" value={item.cwd} mono />
            <PermissionField label="Command" value={item.command} mono block />
          </dl>
          {message ? (
            <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">
              {message.decidedAt} · {message.requestId}
            </div>
          ) : null}
          {pending && request && onDecision ? (
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="border-stone-300/80 bg-white/70 text-stone-900 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-950/40 dark:text-stone-100 dark:hover:bg-stone-900"
                disabled={busy}
                onClick={() => onDecision(request.id, "deny")}
              >
                Deny
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="border-transparent bg-amber-700 text-white shadow-sm hover:bg-amber-800 dark:bg-amber-500 dark:text-stone-950 dark:hover:bg-amber-400"
                disabled={busy}
                onClick={() => onDecision(request.id, "allow")}
              >
                Allow once
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
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
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-70">{label}</dt>
      <dd className={`${mono ? "font-mono text-xs" : ""} ${block ? "whitespace-pre-wrap break-all" : "break-words"}`}>
        {value}
      </dd>
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === "allowed") return "Host command approved once";
  if (status === "timed_out") return "Host command expired";
  return "Host command denied";
}

function statusDescription(status: string): string {
  if (status === "allowed") return "This host command was approved once and recorded for audit.";
  if (status === "denied") return "This host command was denied and did not run.";
  if (status === "timed_out") return "This host command was not approved before the request expired.";
  return "This command will run on the base computer, outside the VM.";
}

function toneClasses(status: string) {
  if (status === "allowed") {
    return {
      card: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-emerald-100",
      icon: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
      pill: "border-emerald-700/35 bg-emerald-100/70 text-emerald-900 dark:border-emerald-300/30 dark:bg-emerald-900/45 dark:text-emerald-100",
    };
  }
  if (status === "denied") {
    return {
      card: "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950/35 dark:text-rose-100",
      icon: "bg-rose-200 text-rose-900 dark:bg-rose-900 dark:text-rose-100",
      pill: "border-rose-700/35 bg-rose-100/70 text-rose-900 dark:border-rose-300/30 dark:bg-rose-900/45 dark:text-rose-100",
    };
  }
  return {
    card: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
    icon: "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
    pill: "border-amber-800/40 bg-amber-100/70 text-amber-900 dark:border-amber-300/30 dark:bg-amber-900/45 dark:text-amber-100",
  };
}
