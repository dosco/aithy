import { createAxLinkChooser, createAxSynthesizer } from "./ax-brains";
import { extractPageData } from "./html";
import {
  SCRAPER_MAX_LINKS_PER_PAGE,
  SCRAPER_MAX_PAGES,
} from "./limits";
import { describeError } from "./text";
import type {
  SmartScrapeResult,
  SmartScraperDeps,
  ScraperPage,
  ScraperSource,
} from "./types";
import { normalizeHttpUrl } from "./url";
import { renderPageWithWebView } from "./webview-renderer";

export async function smartScrape(
  input: { url: string; task: string },
  deps: SmartScraperDeps,
): Promise<SmartScrapeResult> {
  const startUrl = normalizeHttpUrl(input.url);
  if (!startUrl) throw new Error("web.fetch url must be http:// or https://");

  const renderPage = deps.renderPage ?? renderPageWithWebView;
  const chooseLinks = deps.chooseLinks ?? createAxLinkChooser(requiredAiInput(deps));
  const synthesize = deps.synthesize ?? createAxSynthesizer(requiredAiInput(deps));
  const queue = [startUrl];
  const queued = new Set(queue);
  const visited = new Set<string>();
  const pagesVisited: ScraperPage[] = [];
  const sources: ScraperSource[] = [];
  const linksConsidered: SmartScrapeResult["linksConsidered"] = [];
  const errors: string[] = [];

  while (queue.length > 0 && pagesVisited.length < SCRAPER_MAX_PAGES) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    try {
      const rendered = await renderPage(url);
      const pageUrl = normalizeHttpUrl(rendered.url) ?? url;
      const data = extractPageData(
        rendered.html,
        rendered.visibleText,
        pageUrl,
        rendered.title,
      );
      const page = {
        url: pageUrl,
        title: data.title,
        content: data.content,
      };
      pagesVisited.push(page);
      sources.push({
        id: `S${sources.length + 1}`,
        url: page.url,
        title: page.title,
      });

      if (pagesVisited.length >= SCRAPER_MAX_PAGES) continue;
      const candidates = data.links
        .filter((link) => !visited.has(link.url) && !queued.has(link.url))
        .slice(0, SCRAPER_MAX_LINKS_PER_PAGE);
      if (candidates.length === 0) continue;

      const selected = await chooseLinks({
        task: input.task,
        currentPage: page,
        pagesVisited,
        candidateLinks: candidates,
      });
      const selectedByUrl = new Map(
        selected
          .map((choice) => [normalizeHttpUrl(choice.url), choice.reason] as const)
          .filter((entry): entry is readonly [string, string] => Boolean(entry[0])),
      );

      for (const link of candidates) {
        const reason = selectedByUrl.get(link.url);
        linksConsidered.push({
          fromUrl: page.url,
          url: link.url,
          text: link.text,
          decision: reason ? `follow: ${reason}` : "skip",
        });
      }

      for (const link of candidates) {
        if (queue.length + pagesVisited.length >= SCRAPER_MAX_PAGES) break;
        if (!selectedByUrl.has(link.url)) continue;
        queue.push(link.url);
        queued.add(link.url);
      }
    } catch (error) {
      errors.push(`${url}: ${describeError(error)}`);
    }
  }

  const answer = await synthesize({
    task: input.task,
    pagesVisited,
    sources,
  });

  return { answer, pagesVisited, sources, linksConsidered, errors };
}

function requiredAiInput(deps: SmartScraperDeps) {
  if (!deps.config) throw new Error("smart scraper requires AppConfig when Ax callbacks are not provided");
  return { config: deps.config, runtimeStore: deps.runtimeStore };
}
