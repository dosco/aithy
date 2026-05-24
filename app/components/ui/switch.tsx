import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-6 w-11 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--muted))] transition data-[state=checked]:border-[rgb(var(--accent))] data-[state=checked]:bg-[rgb(var(--accent))] disabled:cursor-not-allowed disabled:border-[rgb(var(--border))] disabled:bg-[rgb(var(--muted))]/50",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-[rgb(var(--foreground))] shadow-sm transition data-[state=checked]:translate-x-5 data-[state=checked]:bg-[rgb(var(--accent-foreground))]" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
