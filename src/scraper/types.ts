import type { AppConfig } from "../config/env";
import type { RuntimeStore } from "../runtime/runtime-store";

export interface ScraperPage {
  url: string;
  title: string;
  content: string;
}

export interface ScraperSource {
  id: string;
  url: string;
  title: string;
}

export interface ScraperLinkDecision {
  fromUrl: string;
  url: string;
  text: string;
  decision: string;
}

export interface SmartScrapeResult {
  answer: string;
  pagesVisited: ScraperPage[];
  sources: ScraperSource[];
  linksConsidered: ScraperLinkDecision[];
  errors: string[];
}

export interface RenderedPage {
  url: string;
  title: string;
  html: string;
  visibleText: string;
}

export interface ExtractedLink {
  url: string;
  text: string;
}

export interface ExtractedPageData {
  title: string;
  content: string;
  links: ExtractedLink[];
}

export interface LinkChoice {
  url: string;
  reason: string;
}

export interface ChooseLinksInput {
  task: string;
  currentPage: ScraperPage;
  pagesVisited: ScraperPage[];
  candidateLinks: ExtractedLink[];
}

export interface SynthesizeInput {
  task: string;
  pagesVisited: ScraperPage[];
  sources: ScraperSource[];
}

export interface SmartScraperDeps {
  config?: AppConfig;
  runtimeStore?: RuntimeStore;
  renderPage?: (url: string) => Promise<RenderedPage>;
  chooseLinks?: (input: ChooseLinksInput) => Promise<LinkChoice[]>;
  synthesize?: (input: SynthesizeInput) => Promise<string>;
}
