import { createFileRoute } from "@tanstack/react-router";
import { SkillsPage } from "@/components/skills-page";
import { getSkillsPageState } from "@/server/state.functions";

export const Route = createFileRoute("/skills")({
  loader: () => getSkillsPageState(),
  component: () => <SkillsPage initialState={Route.useLoaderData()} />,
});
