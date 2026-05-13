import { f, fn, type AxAgentFunction } from "@ax-llm/ax";
import type { AppConfig } from "../../config/env";
import { smartScrape } from "../../scraper/smart-spider";
import { argsPreview } from "../../security/capability-broker";
import type { ToolContext } from "../tool-context";

export function createWebFetchTools(
  ctx: ToolContext,
  config: AppConfig,
): AxAgentFunction[] {
  return [
    fn("fetch")
      .namespace("web")
      .description(
        "Read a known http:// or https:// URL with Aithy's local web research sub-agent. It renders the starting page, can follow relevant links, and consolidates a cited answer from the pages it visits. Use this after web.search finds a candidate source, or whenever a specific page needs browser rendering, link-following, or source-cited synthesis.",
      )
      .arg("url", f.string("Starting http:// or https:// URL"))
      .arg("task", f.string("What to learn from the page or linked pages"))
      .returnsField("answer", f.string("Synthesized answer with Markdown source citations"))
      .returnsField("pagesVisited", f.object({
        url: f.string("Visited URL"),
        title: f.string("Page title"),
        content: f.string("Compact extracted page content"),
      }).array("Visited pages"))
      .returnsField("sources", f.object({
        id: f.string("Source id"),
        url: f.string("Source URL"),
        title: f.string("Source title"),
      }).array("Sources cited or checked"))
      .returnsField("linksConsidered", f.object({
        fromUrl: f.string("Page where the link appeared"),
        url: f.string("Candidate link URL"),
        text: f.string("Anchor text or label"),
        decision: f.string("follow or skip decision"),
      }).array("Links considered by the spider"))
      .returnsField("errors", f.string("Non-fatal fetch error").array("Errors encountered while crawling"))
      .example({
        title: "Fetch and synthesize a rendered docs page",
        code: "await web.fetch({ url: 'https://example.com/docs', task: 'Find install requirements and cite the source pages.' });",
      })
      .handler(async ({ url, task }) => {
        ctx.capabilities?.require({
          conversationId: ctx.session.conversationId,
          capability: "web.scrape",
          toolName: "web.fetch",
          argsPreview: argsPreview({ url, task }),
        });
        ctx.events.emit({
          type: "agent.turn",
          conversationId: ctx.session.conversationId,
          summary: `Fetching ${url}`,
        });
        return smartScrape({ url, task }, { config });
      })
      .build(),
  ];
}
