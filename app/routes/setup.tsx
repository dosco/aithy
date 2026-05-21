import { createFileRoute, redirect } from "@tanstack/react-router";
import { SetupPage } from "@/components/setup-page";
import { sanitizeSetupRedirect } from "@/lib/setup-redirect";
import { getSetupPageState } from "@/server/state.functions";

export const Route = createFileRoute("/setup")({
  validateSearch: (search) => ({
    redirect: sanitizeSetupRedirect(search.redirect),
  }),
  loaderDeps: ({ search: { redirect } }) => ({ redirect }),
  loader: async ({ deps }) => {
    const state = await getSetupPageState();
    if (
      state.aiConfigured
      && state.profile.userName.trim()
      && (!state.setupGate.localInferenceRequired || state.setupGate.localInferenceReady)
    ) {
      throw redirect({ href: deps.redirect, replace: true });
    }
    return state;
  },
  component: () => (
    <SetupPage initialState={Route.useLoaderData()} />
  ),
});
