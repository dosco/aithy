import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--panel))] px-4 text-sm outline-none transition placeholder:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--foreground))]",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
