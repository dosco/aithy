import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/automations")({
  loader: () => {
    throw redirect({ to: "/attentions", replace: true });
  },
});
