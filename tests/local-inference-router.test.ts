import { describe, expect, test } from "bun:test";
import { llamaRouterEnv } from "../src/local-inference/router";

describe("llama router process", () => {
  test("starts with an allowlisted environment plus explicit router overrides", () => {
    const originalToken = process.env.AITHY_QUEUE_TOKEN;
    process.env.AITHY_QUEUE_TOKEN = "secret-token";
    try {
      const env = llamaRouterEnv({
        AITHY_ROUTER_MARKER: "intentional",
        OMITTED_ROUTER_VALUE: undefined,
      });

      expect(env.AITHY_QUEUE_TOKEN).toBeUndefined();
      expect(env.AITHY_ROUTER_MARKER).toBe("intentional");
      expect(env).not.toHaveProperty("OMITTED_ROUTER_VALUE");
      expect(env.PATH).toContain("/usr/bin");
    } finally {
      if (originalToken === undefined) delete process.env.AITHY_QUEUE_TOKEN;
      else process.env.AITHY_QUEUE_TOKEN = originalToken;
    }
  });
});
