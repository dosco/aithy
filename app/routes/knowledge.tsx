import { createFileRoute } from "@tanstack/react-router";
import { KnowledgePage } from "@/components/knowledge-page";
import { getKnowledgePageState } from "@/server/knowledge.functions";

export const Route = createFileRoute("/knowledge")({
  loader: () => getKnowledgePageState(),
  component: () => <KnowledgePage initialState={Route.useLoaderData()} />,
});
