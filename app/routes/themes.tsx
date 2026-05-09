import { createFileRoute } from "@tanstack/react-router";
import { ThemesPage } from "@/components/themes-page";
import { getWebState } from "@/server/actions.functions";

export const Route = createFileRoute("/themes")({
  loader: () => getWebState({ data: {} }),
  component: () => <ThemesPage initialState={Route.useLoaderData()} />,
});
