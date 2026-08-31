import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InferenceProfileInputs } from "../app/components/inference-profile-fields";

describe("inference profile fields", () => {
  test("renders provider capabilities for a dynamic named profile", () => {
    const html = render("openrouter", "vendor/model");

    expect(html).toContain("Service tier");
    expect(html).toContain("Flex");
    expect(html).not.toContain("Thinking level");
  });

  test("renders Azure endpoint fields and provider-level capabilities", () => {
    const html = render("azure-openai", "deployment-model");

    expect(html).toContain("Resource Name *");
    expect(html).toContain("Deployment Name *");
    expect(html).toContain("2024-02-15-preview");
    expect(html).toContain("Thinking level");
    expect(html).toContain("Service tier");
  });

  test("uses model exclusions instead of provider defaults", () => {
    const html = render("openai", "gpt-realtime-2");

    expect(html).toContain("Thinking level");
    expect(html).not.toContain("Service tier");
  });

  test("renders the URL for OpenAI-compatible profiles with optional keys", () => {
    const html = render("openai-compatible", "local-model");

    expect(html).toContain("Base URL");
    expect(html).not.toContain("Thinking level");
    expect(html).not.toContain("Service tier");
  });
});

function render(provider: string, model: string): string {
  return renderToStaticMarkup(
    <InferenceProfileInputs
      provider={provider}
      model={model}
      apiUrl=""
      profileArgs={{}}
      thinkingLevel=""
      serviceTier="auto"
      onApiUrlChange={() => {}}
      onProfileArgChange={() => {}}
      onThinkingLevelChange={() => {}}
      onServiceTierChange={() => {}}
    />,
  );
}
