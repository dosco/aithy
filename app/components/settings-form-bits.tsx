import type { ReactNode, TextareaHTMLAttributes } from "react";
import { Check, KeyRound } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { SecretStatusDto } from "@/server/dto";
import { AX_AI_PROVIDERS, modelsForProvider } from "../../src/agent/ai-providers";

export const fieldClass =
  "h-11 w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 text-sm outline-none transition placeholder:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--foreground))]";

export const selectClass =
  `${fieldClass} appearance-none pr-10 bg-no-repeat bg-[right_0.875rem_center] bg-[length:0.75rem_0.75rem] cursor-pointer bg-[image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23888' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'><polyline points='3,6 8,11 13,6'/></svg>")]`;

export function Section({
  title,
  subtitle,
  children,
  muted = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <section
      className={cn(
        "grid gap-4 rounded-2xl border border-[rgb(var(--border))] p-5",
        muted ? "bg-[rgb(var(--muted))]/30" : "bg-[rgb(var(--panel))]/40",
      )}
    >
      <header className="grid gap-1">
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
        {subtitle ? <p className="text-xs text-[rgb(var(--muted-foreground))]">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wider text-[rgb(var(--muted-foreground))]">
        {label}
      </span>
      {children}
    </label>
  );
}

export function ApiKeyInput({
  value,
  onChange,
  secret,
  disabled,
  fallback,
}: {
  value: string;
  onChange: (value: string) => void;
  secret: SecretStatusDto | null;
  disabled?: boolean;
  fallback: string;
}) {
  const placeholder = secret?.configured ? `Stored in ${secret.source}` : fallback;
  return (
    <div
      className={cn(
        "flex items-stretch overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] transition focus-within:border-[rgb(var(--foreground))]",
        disabled && "opacity-50",
      )}
    >
      <span className="flex items-center px-3 text-[rgb(var(--muted-foreground))]">
        <KeyRound className="h-4 w-4" />
      </span>
      <input
        type="password"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        className="h-11 w-full bg-transparent pr-3.5 text-sm outline-none placeholder:text-[rgb(var(--muted-foreground))] disabled:cursor-not-allowed"
      />
      {secret?.configured ? (
        <span className="flex shrink-0 items-center gap-1 border-l border-[rgb(var(--border))] px-3 text-[10px] font-medium uppercase tracking-wider text-[rgb(var(--muted-foreground))]">
          <Check className="h-3 w-3" /> {secret.source}
        </span>
      ) : null}
    </div>
  );
}

export function ModelCombobox({
  provider,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  provider: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const listId = `model-options-${provider || "none"}`;
  const models = provider ? modelsForProvider(provider) : [];
  return (
    <>
      <input
        className={fieldClass}
        value={value}
        list={models.length > 0 ? listId : undefined}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
      />
      {models.length > 0 ? (
        <datalist id={listId}>
          {models.map((model) => <option key={model} value={model} />)}
        </datalist>
      ) : null}
    </>
  );
}

export function ProviderSelect({
  value,
  onChange,
  allowEmpty = false,
}: {
  value: string;
  onChange: (value: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClass}>
      {allowEmpty ? <option value="">- none -</option> : null}
      {AX_AI_PROVIDERS.map((name) => <option key={name} value={name}>{name}</option>)}
    </select>
  );
}

export function FormTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Textarea
      {...props}
      className={cn(
        "rounded-xl border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3.5 py-2.5 text-sm",
        props.className,
      )}
    />
  );
}
