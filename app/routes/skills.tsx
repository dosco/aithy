import { createFileRoute } from "@tanstack/react-router";
import { SkillsPage } from "@/components/skills-page";
import { getWebState } from "@/server/actions.functions";

export const Route = createFileRoute("/skills")({
  loader: () => getWebState({ data: {} }),
  component: () => <SkillsPage initialState={Route.useLoaderData()} />,
});
