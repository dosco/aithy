const LOCAL_WARMUP_TIMEOUT_MS = 60_000;

export async function warmLocalAgentCache(
  input: {
    baseUrl: string;
    modelId: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? LOCAL_WARMUP_TIMEOUT_MS);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  try {
    const response = await fetchImpl(`${input.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: input.modelId,
        messages: [
          {
            role: "system",
            content: "You are Aithy's local warmup check. Reply with one short greeting.",
          },
          { role: "user", content: "hello" },
        ],
        max_tokens: 8,
        temperature: 0,
        stream: false,
      }),
    });
    if (!response.ok) {
      throw new Error(`local warmup failed: HTTP ${response.status}`);
    }
    const body = await response.json() as { choices?: unknown[] };
    if (!Array.isArray(body.choices) || body.choices.length === 0) {
      throw new Error("local warmup returned no choices");
    }
  } finally {
    clearTimeout(timer);
  }
}
