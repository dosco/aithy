import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-4 text-sm text-[rgb(var(--foreground))] caret-[rgb(var(--foreground))] outline-none transition placeholder:text-[rgb(var(--muted-foreground))] read-only:bg-[rgb(var(--muted))]/35 read-only:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:bg-[rgb(var(--muted))]/50 disabled:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--foreground))]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
