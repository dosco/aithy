import { createFileRoute } from "@tanstack/react-router";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";

export const Route = createFileRoute("/api/events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const runtime = await getAithyRuntime();
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const send = (event: unknown) => {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
              );
            };
            send({ type: "connected", createdAt: new Date().toISOString() });
            const unsubscribe = runtime.live.subscribe(send);
            request.signal.addEventListener("abort", () => {
              unsubscribe();
              controller.close();
            });
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
