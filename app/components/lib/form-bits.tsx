import { forwardRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const fieldClass =
  "h-10 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3 text-sm outline-none transition placeholder:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--foreground))]";

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("grid min-h-0 content-start gap-1.5", className)}>
      <span className="text-[10px] font-medium uppercase tracking-wider text-[rgb(var(--muted-foreground))]">
        {label}
      </span>
      {children}
    </label>
  );
}

export const FormTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <Textarea
    ref={ref}
    {...props}
    className={cn(
      "rounded-lg border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-3 py-2 text-sm",
      className,
    )}
  />
));
FormTextarea.displayName = "FormTextarea";

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
      {message}
    </div>
  );
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
