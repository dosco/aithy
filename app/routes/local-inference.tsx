import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/local-inference")({
  loader: ({ location }) => {
    if (location.pathname !== "/local-inference") return;
    throw redirect({ to: "/inference", replace: true });
  },
});
