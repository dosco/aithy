import { createFileRoute } from "@tanstack/react-router";
import { MemoryPage } from "@/components/memory-page";
import { getMemoryPageState } from "@/server/state.functions";

export const Route = createFileRoute("/memory")({
  loader: () => getMemoryPageState(),
  component: () => <MemoryPage initialState={Route.useLoaderData()} />,
});
