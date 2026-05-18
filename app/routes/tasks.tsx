import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/components/tasks-page";
import { getTasksPageState } from "@/server/state.functions";

export const Route = createFileRoute("/tasks")({
  loader: () => getTasksPageState(),
  component: () => <TasksPage initialState={Route.useLoaderData()} />,
});
