import { createFileRoute } from "@tanstack/react-router";
import { getAithyRuntime } from "../../src/runtime/aithy-runtime.server";
import { assertLoopbackRequest } from "../../src/settings/localhost";
import { serveArtifactRequest } from "../../src/artifacts/serve";

export const Route = createFileRoute("/api/artifacts/$artifactId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        assertLoopbackRequest(request);
        const runtime = await getAithyRuntime();
        return serveArtifactRequest(request, runtime.artifacts, params.artifactId);
      },
    },
  },
});
