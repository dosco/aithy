import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "@/components/chat-page";
import { getWebState } from "@/server/actions.functions";

export const Route = createFileRoute("/chat")({
  loader: () => getWebState({ data: {} }),
  component: () => <ChatPage initialState={Route.useLoaderData()} />,
});
