import { createFileRoute } from "@tanstack/react-router";
import { UsagePage } from "@/components/usage-page";
import { getWebState } from "@/server/actions.functions";

export const Route = createFileRoute("/usage")({
  loader: () => getWebState({ data: {} }),
  component: () => <UsagePage initialState={Route.useLoaderData()} />,
});
