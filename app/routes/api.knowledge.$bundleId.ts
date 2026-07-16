import { createFileRoute } from "@tanstack/react-router";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";

export const Route = createFileRoute("/api/knowledge/$bundleId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        assertLoopbackRequest(request);
        const result = await (await getAithyRuntime()).knowledge.exportOkf(params.bundleId);
        return new Response(new Uint8Array(result.bytes).buffer, {
          headers: {
            "content-type": "application/gzip",
            "content-disposition": `attachment; filename="${result.filename}"`,
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
