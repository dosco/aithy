import { f, fn, type AxAgentFunction } from "@ax-llm/ax";
import type { AppConfig } from "../../config/env";
import { parallelWebSearch } from "../../search/parallel-search-client";
import { argsPreview } from "../../security/capability-broker";
import type { ToolContext } from "../tool-context";

export function createWebSearchTools(
  ctx: ToolContext,
  config: AppConfig,
): AxAgentFunction[] {
  return [
    fn("search")
      .namespace("web")
      .description(
        "Search the public web with Parallel Search MCP to discover current or relevant source URLs. Use this for recent scores, news, weather, prices, and explicit user requests like 'search it up' or 'look it up'. Use it for source discovery before calling web.fetch on specific pages. Do not use this to read a known URL in depth.",
      )
      .arg("query", f.string("Natural-language web search query"))
      .arg("task", f.string("What the search is meant to help answer"))
      .returnsField("answer", f.string("Parallel search result text with URLs and excerpts"))
      .returnsField("provider", f.string("Search provider name"))
      .returnsField("rawContent", f.string("Raw text returned by the MCP tool"))
      .example({
        title: "Find candidate source pages",
        code: "await web.search({ query: 'Parallel Search MCP no API key rate limits', task: 'Find current docs about free anonymous usage.' });",
      })
      .handler(async ({ query, task }) => {
        ctx.capabilities?.require({
          conversationId: ctx.session.conversationId,
          capability: "web.search",
          toolName: "web.search",
          argsPreview: argsPreview({ query, task }),
        });
        ctx.events.emit({
          type: "agent.turn",
          conversationId: ctx.session.conversationId,
          summary: `Searching the web for ${query}`,
        });
        return parallelWebSearch({ query, task }, {
          url: config.parallelSearchMcpUrl,
          apiKey: config.parallelApiKey,
        });
      })
      .build(),
  ];
}
