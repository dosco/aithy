import { createFileRoute } from "@tanstack/react-router";
import { InferencePage } from "@/components/inference-page";
import { getInferencePageState } from "@/server/state.functions";

export const Route = createFileRoute("/inference")({
  loader: () => getInferencePageState(),
  component: () => <InferencePage initialState={Route.useLoaderData()} />,
});
