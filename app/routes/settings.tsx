import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/settings-page";
import { getWebState } from "@/server/actions.functions";

export const Route = createFileRoute("/settings")({
  loader: () => getWebState({ data: {} }),
  component: () => <SettingsPage initialState={Route.useLoaderData()} />,
});
