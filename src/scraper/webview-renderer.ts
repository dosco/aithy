import { WEBVIEW_SETTLE_MS } from "./limits";
import type { RenderedPage } from "./types";

export async function renderPageWithWebView(url: string): Promise<RenderedPage> {
  if (!("WebView" in Bun) || typeof Bun.WebView !== "function") {
    throw new Error("Bun.WebView is not available in this Bun runtime");
  }

  const view = new Bun.WebView({
    width: 1280,
    height: 900,
    dataStore: "ephemeral",
  });
  try {
    await view.navigate(url);
    await view.evaluate(`new Promise((resolve) => setTimeout(resolve, ${WEBVIEW_SETTLE_MS}))`);
    return await view.evaluate<RenderedPage>(`(() => ({
      url: location.href,
      title: document.title || "",
      html: document.documentElement ? document.documentElement.outerHTML : "",
      visibleText: document.body ? document.body.innerText : ""
    }))()`);
  } finally {
    view.close();
  }
}
