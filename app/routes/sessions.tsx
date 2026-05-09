import { createFileRoute } from "@tanstack/react-router";
import { SessionsPage } from "@/components/sessions-page";
import { getWebState } from "@/server/actions.functions";

export const Route = createFileRoute("/sessions")({
  loader: () => getWebState({ data: {} }),
  component: () => <SessionsPage initialState={Route.useLoaderData()} />,
});
