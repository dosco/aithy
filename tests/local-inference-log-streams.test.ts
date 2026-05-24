import { describe, expect, test } from "bun:test";
import { llamaLogLevel } from "../src/runtime/services/local-inference/log-streams";

describe("local inference llama log classification", () => {
  test("classifies llama stderr info lines as info", () => {
    expect(llamaLogLevel("stderr", "0.02.536.676 I srv  proxy_reques: proxying request")).toBe("info");
    expect(llamaLogLevel("stderr", "I srv load_models: Loaded 3 custom model presets")).toBe("info");
  });

  test("classifies warning markers as warn", () => {
    expect(llamaLogLevel("stderr", "W srv cache is almost full")).toBe("warn");
    expect(llamaLogLevel("stderr", "warning: using fallback")).toBe("warn");
  });

  test("classifies actual errors as error", () => {
    expect(llamaLogLevel("stderr", "error: model load failed")).toBe("error");
    expect(llamaLogLevel("stderr", "fatal: router crashed")).toBe("error");
  });

  test("keeps stdout as info", () => {
    expect(llamaLogLevel("stdout", "anything on stdout")).toBe("info");
  });
});
