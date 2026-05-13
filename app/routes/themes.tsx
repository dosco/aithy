import { createFileRoute } from "@tanstack/react-router";
import { ThemesPage } from "@/components/themes-page";
import { getThemesPageState } from "@/server/state.functions";

export const Route = createFileRoute("/themes")({
  loader: () => getThemesPageState(),
  component: () => <ThemesPage initialState={Route.useLoaderData()} />,
});
