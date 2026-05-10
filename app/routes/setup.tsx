import { createFileRoute, redirect } from "@tanstack/react-router";
import { SetupPage } from "@/components/setup-page";
import { sanitizeSetupRedirect } from "@/lib/setup-redirect";
import { getWebState } from "@/server/actions.functions";

export const Route = createFileRoute("/setup")({
  validateSearch: (search) => ({
    redirect: sanitizeSetupRedirect(search.redirect),
  }),
  loaderDeps: ({ search: { redirect } }) => ({ redirect }),
  loader: async ({ deps }) => {
    const state = await getWebState({ data: {} });
    if (state.aiConfigured) {
      throw redirect({ href: deps.redirect, replace: true });
    }
    return state;
  },
  component: () => (
    <SetupPage
      initialState={Route.useLoaderData()}
      redirectTo={Route.useSearch().redirect}
    />
  ),
});
