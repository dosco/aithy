import { providerDisplayName } from "../agent/ai-providers";

export function normalizeProviderApiUrl(provider: string, value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${providerDisplayName(provider)} base URL is required.`);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${providerDisplayName(provider)} base URL must be a valid URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${providerDisplayName(provider)} base URL must start with http:// or https://.`);
  }
  if (url.username || url.password) {
    throw new Error(`${providerDisplayName(provider)} base URL must not include embedded credentials.`);
  }
  return url.href;
}
