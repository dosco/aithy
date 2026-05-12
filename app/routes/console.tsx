import { createFileRoute } from "@tanstack/react-router";
import { ConsolePage } from "@/components/console/console-page";
import { PageFrame } from "@/components/page-frame";
import { getRuntimeConsole } from "@/server/console.functions";

export const Route = createFileRoute("/console")({
  loader: () => getRuntimeConsole({ data: {} }),
  component: ConsoleRoute,
});

function ConsoleRoute() {
  const state = Route.useLoaderData();
  return (
    <PageFrame eyebrow="Runtime" title="Console">
      <ConsolePage initialState={state} />
    </PageFrame>
  );
}
