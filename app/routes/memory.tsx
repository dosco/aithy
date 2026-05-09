import { createFileRoute } from "@tanstack/react-router";
import { MemoryPage } from "@/components/memory-page";
import { getWebState } from "@/server/actions.functions";

export const Route = createFileRoute("/memory")({
  loader: () => getWebState({ data: {} }),
  component: () => <MemoryPage initialState={Route.useLoaderData()} />,
});
