import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "block w-full resize-none rounded-[28px] border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-4 py-2.5 text-base leading-6 text-[rgb(var(--foreground))] caret-[rgb(var(--foreground))] outline-none transition placeholder:text-[rgb(var(--muted-foreground))] read-only:bg-[rgb(var(--muted))]/35 read-only:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:bg-[rgb(var(--muted))]/50 disabled:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--foreground))]",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
