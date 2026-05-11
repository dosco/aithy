import { SCRAPER_MAX_CONTENT_CHARS } from "./limits";
import { cleanText, clampText } from "./text";
import type { ExtractedLink, ExtractedPageData } from "./types";
import { normalizeHttpUrl } from "./url";

export function extractPageData(
  html: string,
  visibleText: string,
  baseUrl: string,
  fallbackTitle = "",
): ExtractedPageData {
  const links: ExtractedLink[] = [];
  const seenLinks = new Set<string>();
  const titleParts: string[] = [];
  const headingParts: string[] = [];
  const metaParts: string[] = [];
  const anchorStack: Array<{ url: string; text: string[]; label: string }> = [];

  const addLink = (href: string | null, label: string) => {
    if (!href) return;
    const url = normalizeHttpUrl(href, baseUrl);
    if (!url || seenLinks.has(url)) return;
    seenLinks.add(url);
    anchorStack.push({ url, text: [], label });
  };

  const finishLink = () => {
    const link = anchorStack.pop();
    if (!link) return;
    links.push({
      url: link.url,
      text: cleanText([...link.text, link.label].join(" ")).slice(0, 240),
    });
  };

  new HTMLRewriter()
    .on("title", {
      text(text) {
        titleParts.push(text.text);
      },
    })
    .on("meta[name='description'], meta[property='og:description']", {
      element(element) {
        const content = element.getAttribute("content");
        if (content) metaParts.push(content);
      },
    })
    .on("h1, h2, h3", {
      text(text) {
        headingParts.push(text.text);
      },
    })
    .on("a[href]", {
      element(element) {
        addLink(
          element.getAttribute("href"),
          element.getAttribute("aria-label")
            ?? element.getAttribute("title")
            ?? "",
        );
        element.onEndTag(finishLink);
      },
      text(text) {
        const current = anchorStack.at(-1);
        if (current) current.text.push(text.text);
      },
    })
    .transform(html);

  while (anchorStack.length > 0) finishLink();

  const title = cleanText(titleParts.join(" ")) || cleanText(fallbackTitle) || baseUrl;
  const content = clampText(
    [
      title,
      cleanText(metaParts.join("\n")),
      cleanText(headingParts.join("\n")),
      cleanText(visibleText),
    ].filter(Boolean).join("\n\n"),
    SCRAPER_MAX_CONTENT_CHARS,
  );

  return { title, content, links };
}
