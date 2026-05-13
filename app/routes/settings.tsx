import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/settings-page";
import { getSettingsPageState } from "@/server/state.functions";

export const Route = createFileRoute("/settings")({
  loader: () => getSettingsPageState(),
  component: () => <SettingsPage initialState={Route.useLoaderData()} />,
});
