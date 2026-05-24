import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "ghost" | "soft" | "danger";
type ButtonSize = "sm" | "md" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variants: Record<ButtonVariant, string> = {
  default: "border-[rgb(var(--accent))] bg-[rgb(var(--accent))] text-[rgb(var(--accent-foreground))] hover:brightness-95",
  ghost: "border-transparent bg-transparent text-[rgb(var(--muted-foreground))] hover:border-[rgb(var(--border))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--foreground))]",
  soft: "bg-[rgb(var(--muted))] text-[rgb(var(--foreground))] hover:bg-[rgb(var(--muted))]/80",
  danger: "border-[rgb(var(--danger)/0.38)] bg-[rgb(var(--danger)/0.12)] text-[rgb(var(--danger))] hover:bg-[rgb(var(--danger)/0.18)]",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  icon: "h-10 w-10 p-0",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-full border border-[rgb(var(--border))] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--foreground))]/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-[rgb(var(--border))] disabled:bg-[rgb(var(--muted))]/50 disabled:text-[rgb(var(--muted-foreground))]",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
