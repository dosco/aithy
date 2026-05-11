import type { ReactNode } from "react";
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  redirect,
  Scripts,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Button } from "@/components/ui/button";
import {
  isSetupGuardExemptPath,
  sanitizeSetupRedirect,
} from "@/lib/setup-redirect";
import { readSetupGateState } from "@/lib/setup-gate";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Aithy" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  beforeLoad: async ({ location }) => {
    if (isSetupGuardExemptPath(location.pathname)) return;
    const state = await readSetupGateState();
    if (!state.aiConfigured || !state.profileConfigured) {
      throw redirect({
        to: "/setup",
        search: { redirect: sanitizeSetupRedirect(location.href) },
        replace: true,
      });
    }
  },
  component: RootComponent,
  errorComponent: RootErrorComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <AppShell>
        <Outlet />
      </AppShell>
    </RootDocument>
  );
}

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return (
    <RootDocument>
      <div className="flex min-h-screen flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-md space-y-5 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[rgb(var(--muted))]">
            <TriangleAlert className="h-7 w-7 text-[rgb(var(--danger)_/_0.9)]" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">Hmm, I lost my train of thought.</h1>
            <p className="text-sm text-[rgb(var(--foreground)_/_0.7)]">
              Something interrupted me mid-thought. Want to ask me again?
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button onClick={() => reset()}>Let’s try again</Button>
            <Button variant="ghost" asChild>
              <Link to="/chat">Back to chat</Link>
            </Button>
          </div>
          <details className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--panel))] text-left">
            <summary className="cursor-pointer select-none px-4 py-2 text-xs text-[rgb(var(--foreground)_/_0.6)] hover:text-[rgb(var(--foreground))]">
              What went wrong
            </summary>
            <pre className="m-0 overflow-auto whitespace-pre-wrap break-words px-4 pb-3 pt-1 text-xs text-[rgb(var(--foreground)_/_0.75)]">
              {message}
              {stack ? `\n\n${stack}` : ""}
            </pre>
          </details>
        </div>
      </div>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var p=JSON.parse(localStorage.getItem("aithy-theme")||"{}");var d=p.colorMode==="dark"||(p.colorMode==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",!!d);document.documentElement.dataset.theme=p.theme||"paper";document.documentElement.dataset.layout=p.layout||"chat"}catch{document.documentElement.dataset.theme="paper";document.documentElement.dataset.layout="chat"}`,
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
