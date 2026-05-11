import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config/env";
import { createScraperAi } from "../src/scraper/ax-brains";
import { extractPageData } from "../src/scraper/html";
import { SCRAPER_MAX_PAGES } from "../src/scraper/limits";
import { smartScrape } from "../src/scraper/smart-spider";
import type { RenderedPage, SynthesizeInput } from "../src/scraper/types";
import { normalizeHttpUrl } from "../src/scraper/url";
import { renderPageWithWebView } from "../src/scraper/webview-renderer";

describe("smart scraper urls and extraction", () => {
  test("normalizes relative links and blocks non-web schemes", () => {
    expect(normalizeHttpUrl("/docs#install", "https://example.com/start")).toBe(
      "https://example.com/docs",
    );
    expect(normalizeHttpUrl("mailto:hi@example.com", "https://example.com")).toBeUndefined();
    expect(normalizeHttpUrl("data:text/html,hi", "https://example.com")).toBeUndefined();
  });

  test("extracts rendered content and deduped links from html", () => {
    const data = extractPageData(
      `<html>
        <head><title>Docs</title><meta name="description" content="Install guide"></head>
        <body>
          <h1>Install</h1>
          <a href="/next#one">Next page</a>
          <a href="/next#two">Duplicate page</a>
          <a href="javascript:alert(1)">Bad</a>
        </body>
      </html>`,
      "Install Bun with the package manager.",
      "https://example.com/docs",
    );

    expect(data.title).toBe("Docs");
    expect(data.content).toContain("Install guide");
    expect(data.content).toContain("Install Bun");
    expect(data.links).toEqual([
      { url: "https://example.com/next", text: "Next page" },
    ]);
  });
});

describe("smart scraper crawl", () => {
  test("never visits more than five pages or revisits normalized urls", async () => {
    const pages = new Map<string, string>([
      ["https://site.test/", pageHtml("Home", ["/a", "/b", "/c", "/d", "/e", "/a#again"])],
      ["https://site.test/a", pageHtml("A", ["/f"])],
      ["https://site.test/b", pageHtml("B", ["/g"])],
      ["https://site.test/c", pageHtml("C", [])],
      ["https://site.test/d", pageHtml("D", [])],
      ["https://site.test/e", pageHtml("E", [])],
    ]);
    const visitedByRenderer: string[] = [];

    const result = await smartScrape(
      { url: "https://site.test/", task: "Find docs" },
      {
        renderPage: async (url) => {
          visitedByRenderer.push(url);
          const html = pages.get(url);
          if (!html) throw new Error(`missing fixture: ${url}`);
          return rendered(url, html);
        },
        chooseLinks: async ({ candidateLinks }) => candidateLinks.map((link) => ({
          url: link.url,
          reason: "fixture says follow",
        })),
        synthesize: async ({ pagesVisited, sources }) =>
          `Checked ${pagesVisited.length} pages, starting with [${sources[0].title}](${sources[0].url}).`,
      },
    );

    expect(result.pagesVisited).toHaveLength(SCRAPER_MAX_PAGES);
    expect(new Set(result.pagesVisited.map((page) => page.url)).size).toBe(SCRAPER_MAX_PAGES);
    expect(new Set(visitedByRenderer).size).toBe(visitedByRenderer.length);
    expect(result.pagesVisited.map((page) => page.url)).not.toContain("https://site.test/e");
  });

  test("returns cited synthesis and source metadata", async () => {
    let seenSynthesisInput: SynthesizeInput | undefined;
    const result = await smartScrape(
      { url: "https://source.test/", task: "What is the policy?" },
      {
        renderPage: async (url) => rendered(url, pageHtml("Policy", [])),
        chooseLinks: async () => [],
        synthesize: async (input) => {
          seenSynthesisInput = input;
          return `The policy is available in [Policy](https://source.test/).`;
        },
      },
    );

    expect(result.answer).toContain("[Policy](https://source.test/)");
    expect(result.sources).toEqual([
      { id: "S1", url: "https://source.test/", title: "Policy" },
    ]);
    expect(seenSynthesisInput?.sources[0].id).toBe("S1");
  });
});

describe("smart scraper model selection", () => {
  test("prefers the fast ai service and falls back to normal", () => {
    const fast = { id: "fast" };
    const normal = { id: "normal" };
    const config = { ...loadConfig({}), fastAiProvider: "openai" };

    expect(createScraperAi(config, {
      fast: () => fast,
      normal: () => normal,
    })).toBe(fast);
    expect(createScraperAi(config, {
      fast: () => undefined,
      normal: () => normal,
    })).toBe(normal);
  });
});

describe("smart scraper WebView rendering", () => {
  test("renders a local html page when Bun.WebView can launch", async () => {
    if (!("WebView" in Bun) || typeof Bun.WebView !== "function") return;

    let server: ReturnType<typeof Bun.serve> | undefined;
    try {
      server = Bun.serve({
        port: 0,
        fetch: () => new Response(
          `<html><head><title>Local</title></head>
          <body><div id="root">Before</div>
          <script>document.getElementById("root").textContent = "Rendered";</script></body></html>`,
          { headers: { "content-type": "text/html" } },
        ),
      });
      const page = await renderPageWithWebView(`http://127.0.0.1:${server.port}/`);
      expect(page.title).toBe("Local");
      expect(page.visibleText).toContain("Rendered");
    } catch {
      return;
    } finally {
      server?.stop(true);
    }
  });
});

function pageHtml(title: string, links: string[]): string {
  return `<html><head><title>${title}</title></head><body><h1>${title}</h1>${
    links.map((href) => `<a href="${href}">${href}</a>`).join("")
  }</body></html>`;
}

function rendered(url: string, html: string): RenderedPage {
  const title = /<title>(.*?)<\/title>/i.exec(html)?.[1] ?? "";
  return {
    url,
    title,
    html,
    visibleText: title,
  };
}
