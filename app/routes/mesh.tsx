import { createFileRoute } from "@tanstack/react-router";
import { MeshPage } from "@/components/mesh-page";
import { getMeshPageState } from "@/server/state.functions";

export const Route = createFileRoute("/mesh")({
  loader: () => getMeshPageState(),
  component: () => <MeshPage initialState={Route.useLoaderData()} />,
});
