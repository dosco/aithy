import { createFileRoute, redirect } from "@tanstack/react-router";
import { HOME_SESSION_ID } from "../../src/session/home-session";

export const Route = createFileRoute("/")({
  loader: () => {
    throw redirect({ to: "/chat/$sessionId", params: { sessionId: HOME_SESSION_ID } });
  },
});
