import { createFileRoute } from "@tanstack/react-router";
import { ChatPage } from "@/components/chat-page";
import { getWebState } from "@/server/actions.functions";

export const Route = createFileRoute("/chat/$sessionId")({
  loader: ({ params }) =>
    getWebState({ data: { conversationId: params.sessionId } }),
  component: () => <ChatPage initialState={Route.useLoaderData()} />,
});
