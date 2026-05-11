import type { ExtractedLink, ScraperPage, ScraperSource } from "./types";

export function formatPage(page: ScraperPage): string {
  return `URL: ${page.url}\nTitle: ${page.title}\nContent:\n${page.content}`;
}

export function formatLink(link: ExtractedLink): string {
  return `- ${link.url}${link.text ? ` - ${link.text}` : ""}`;
}

export function formatPagesForSynthesis(
  pages: ScraperPage[],
  sources: ScraperSource[],
): string {
  if (pages.length === 0) return "(no pages were successfully crawled)";
  return pages.map((page, index) => {
    const source = sources[index];
    const id = source?.id ?? `S${index + 1}`;
    return `${id}: ${page.title}\nURL: ${page.url}\nContent:\n${page.content}`;
  }).join("\n\n---\n\n");
}
