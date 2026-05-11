import { ax, f } from "@ax-llm/ax";
import type { AppConfig } from "../config/env";
import { createAiService, createFastAiService } from "../agent/ai-service";
import { formatLink, formatPage, formatPagesForSynthesis } from "./format";
import { cleanText } from "./text";
import type {
  ChooseLinksInput,
  LinkChoice,
  SynthesizeInput,
} from "./types";

const chooseLinksSignature = f()
  .input("task", f.string("The user's scraping task"))
  .input("currentPage", f.string("The current page summary"))
  .input("pagesVisited", f.string("Compact summaries of pages already visited"))
  .input("candidateLinks", f.string("Candidate links as URL plus anchor text"))
  .output("nextUrls", f.string("Absolute URL to visit next").array("Relevant URLs to follow, in priority order"))
  .output("reasoning", f.string("Brief reason for the selected links"))
  .build();

const synthesizeSignature = f()
  .input("task", f.string("The user's scraping task"))
  .input("pages", f.string("Crawled page content with source ids and URLs"))
  .output("answer", f.string("Cited final answer in Markdown"))
  .build();

const chooseLinksDescription = `You choose which webpage links a bounded smart spider should follow.

Rules:
- Pick only links likely to help answer the task.
- Return at most 3 URLs.
- Use only URLs from candidateLinks, exactly as written.
- Prefer specific content pages over navigation, login, social, ads, and legal boilerplate.
- Return an empty nextUrls list when the visited pages are already enough.`;

const synthesizeDescription = `You answer a scraping task from crawled webpages.

Rules:
- Use only the supplied page content.
- Cite factual claims with inline Markdown links to the source page URL.
- If the crawl did not find enough information, say so and cite the pages checked.
- Keep the answer concise.`;

export function createScraperAi(
  config: AppConfig,
  factories = {
    fast: createFastAiService,
    normal: createAiService,
  },
): any {
  return factories.fast(config) ?? factories.normal(config);
}

export function createAxLinkChooser(config: AppConfig) {
  const ai = createScraperAi(config);
  const program = ax(chooseLinksSignature, {
    description: chooseLinksDescription,
    maxSteps: 1,
  } as any);

  return async (input: ChooseLinksInput): Promise<LinkChoice[]> => {
    const result = await program.forward(ai, {
      task: input.task,
      currentPage: formatPage(input.currentPage),
      pagesVisited: input.pagesVisited.map(formatPage).join("\n\n"),
      candidateLinks: input.candidateLinks.map(formatLink).join("\n"),
    });
    const reasoning = cleanText(String(result.reasoning ?? ""));
    return arrayOfStrings(result.nextUrls).map((url) => ({
      url,
      reason: reasoning || "relevant to task",
    }));
  };
}

export function createAxSynthesizer(config: AppConfig) {
  const ai = createScraperAi(config);
  const program = ax(synthesizeSignature, {
    description: synthesizeDescription,
    maxSteps: 1,
  } as any);

  return async (input: SynthesizeInput): Promise<string> => {
    const result = await program.forward(ai, {
      task: input.task,
      pages: formatPagesForSynthesis(input.pagesVisited, input.sources),
    });
    return String(result.answer ?? "");
  };
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
