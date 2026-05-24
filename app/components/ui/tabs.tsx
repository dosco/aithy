import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.6)] p-1 text-[rgb(var(--foreground))]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "rounded-full border border-transparent px-4 py-1.5 text-sm transition data-[state=active]:border-[rgb(var(--accent))] data-[state=active]:bg-[rgb(var(--accent))] data-[state=active]:text-[rgb(var(--accent-foreground))] data-[state=inactive]:text-[rgb(var(--muted-foreground))] data-[state=inactive]:hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:text-[rgb(var(--muted-foreground))]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-6 outline-none", className)} {...props} />;
}
