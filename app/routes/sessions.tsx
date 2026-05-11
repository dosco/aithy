import { createFileRoute } from "@tanstack/react-router";
import { PageFrame } from "@/components/page-frame";
import { SessionsPage } from "@/components/sessions-page";
import { getSessionsPageState } from "@/server/state.functions";

export const Route = createFileRoute("/sessions")({
  loader: () => getSessionsPageState(),
  pendingMs: 0,
  pendingMinMs: 0,
  pendingComponent: SessionsPending,
  component: () => <SessionsPage initialState={Route.useLoaderData()} />,
});

function SessionsPending() {
  return (
    <PageFrame eyebrow="Memory" title="Saved sessions without the sidebar ceremony.">
      <div className="app-sessions-actions mb-5 flex justify-end">
        <div className="h-10 w-32 rounded-xl bg-[rgb(var(--muted))]" />
      </div>
      <div className="app-sessions-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-28 rounded-[20px] border border-[rgb(var(--border))] bg-[rgb(var(--panel)/0.45)] p-4"
          >
            <div className="h-4 w-2/3 rounded bg-[rgb(var(--muted))]" />
            <div className="mt-8 flex justify-between">
              <div className="h-3 w-16 rounded bg-[rgb(var(--muted))]" />
              <div className="h-3 w-20 rounded bg-[rgb(var(--muted))]" />
            </div>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}
