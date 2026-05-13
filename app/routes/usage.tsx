import { createFileRoute } from "@tanstack/react-router";
import { UsagePage } from "@/components/usage-page";
import { getUsagePageState } from "@/server/state.functions";

export const Route = createFileRoute("/usage")({
  loader: () => getUsagePageState(),
  component: () => <UsagePage initialState={Route.useLoaderData()} />,
});
