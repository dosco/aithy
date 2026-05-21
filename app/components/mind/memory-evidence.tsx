import { Quote } from "lucide-react";
import { cn } from "@/lib/utils";

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MAX_TEXT_FRAGMENT_CHARS = 240;
const USER_SAID_PATTERN = new RegExp(
  `^\\s*In\\s+session\\s+(${UUID_PATTERN})\\s*,\\s*the\\s+user\\s+said\\s*:\\s*([\\s\\S]+?)\\s*$`,
  "i",
);
const SESSION_PREFIX_PATTERN = new RegExp(
  `^\\s*In\\s+session\\s+(${UUID_PATTERN})\\s*,\\s*([\\s\\S]+?)\\s*$`,
  "i",
);

export interface ParsedMemoryEvidence {
  kind: "user_quote" | "session_note" | "plain";
  text: string;
  sourceLabel: string;
  sessionId: string | null;
}

export function parseMemoryEvidence(evidence: string | null | undefined): ParsedMemoryEvidence | null {
  const raw = evidence?.trim() ?? "";
  if (!raw) return null;

  const userSaid = raw.match(USER_SAID_PATTERN);
  if (userSaid) {
    return {
      kind: "user_quote",
      text: compactEvidence(userSaid[2]),
      sourceLabel: "You said",
      sessionId: userSaid[1],
    };
  }

  const sessionNote = raw.match(SESSION_PREFIX_PATTERN);
  if (sessionNote) {
    return {
      kind: "session_note",
      text: compactEvidence(sessionNote[2]),
      sourceLabel: "Session note",
      sessionId: sessionNote[1],
    };
  }

  return {
    kind: "plain",
    text: compactEvidence(raw),
    sourceLabel: "Evidence",
    sessionId: null,
  };
}

export function shortSessionId(sessionId: string): string {
  return sessionId.slice(-4);
}

export function chatTextFragmentHref(sessionId: string, text: string): string {
  const cleaned = textFragmentSearchText(text);
  const path = `/chat/${encodeURIComponent(sessionId)}`;
  return cleaned ? `${path}#:~:text=${encodeTextFragment(cleaned)}` : path;
}

export function MemoryEvidencePill({
  evidence,
  className,
}: {
  evidence: string | null | undefined;
  className?: string;
}) {
  const parsed = parseMemoryEvidence(evidence);
  if (!parsed) return null;

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full bg-[rgb(var(--muted))]/70 px-2 py-0.5 text-[11px] text-[rgb(var(--muted-foreground))]",
        className,
      )}
      title={displayEvidenceText(parsed)}
    >
      <Quote className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">{displayEvidenceText(parsed)}</span>
      {parsed.sessionId ? <SessionEvidenceLink evidenceText={parsed.text} sessionId={parsed.sessionId} compact /> : null}
    </span>
  );
}

export function MemoryEvidenceBlock({
  evidence,
  className,
}: {
  evidence: string | null | undefined;
  className?: string;
}) {
  const parsed = parseMemoryEvidence(evidence);
  if (!parsed) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--muted))]/35 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Quote className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--muted-foreground))]" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium text-[rgb(var(--muted-foreground))]">
            {parsed.sourceLabel}
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[rgb(var(--foreground))]">
            {displayEvidenceText(parsed)}
          </p>
        </div>
        {parsed.sessionId ? <SessionEvidenceLink evidenceText={parsed.text} sessionId={parsed.sessionId} /> : null}
      </div>
    </div>
  );
}

function SessionEvidenceLink({
  evidenceText,
  sessionId,
  compact = false,
}: {
  evidenceText: string;
  sessionId: string;
  compact?: boolean;
}) {
  return (
    <a
      href={chatTextFragmentHref(sessionId, evidenceText)}
      title={`Open session ${sessionId} at matching text`}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        "pointer-events-auto inline-flex shrink-0 items-center rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--panel))] font-mono text-[10px] leading-none text-[rgb(var(--foreground))] transition hover:border-[rgb(var(--foreground))]/35 hover:bg-[rgb(var(--panel))]",
        compact ? "px-1.5 py-0.5" : "px-2 py-1",
      )}
    >
      ...{shortSessionId(sessionId)}
    </a>
  );
}

function displayEvidenceText(parsed: ParsedMemoryEvidence): string {
  if (parsed.kind === "user_quote") return `"${stripWrappingQuotes(parsed.text)}"`;
  return parsed.text;
}

function stripWrappingQuotes(value: string): string {
  return value.replace(/^["']+|["']+$/g, "");
}

function compactEvidence(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function textFragmentSearchText(value: string): string {
  return compactEvidence(value).slice(0, MAX_TEXT_FRAGMENT_CHARS).trim();
}

function encodeTextFragment(value: string): string {
  return encodeURIComponent(value)
    .replace(/-/g, "%2D")
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
