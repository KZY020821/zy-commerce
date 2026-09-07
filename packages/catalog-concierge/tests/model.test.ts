import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, isAssistantConfigured, resolveModelConfig } from "../src/model";

describe("resolveModelConfig", () => {
  it("resolves DeepSeek credentials with sensible defaults", () => {
    expect(resolveModelConfig({ DEEPSEEK_API_KEY: "sk-deepseek-x" })).toEqual({ model: DEFAULT_MODEL, apiKey: "sk-deepseek-x", baseURL: "https://api.deepseek.com" });
  });

  it("honours AI_MODEL and AI_BASE_URL overrides", () => {
    expect(resolveModelConfig({ DEEPSEEK_API_KEY: "k", AI_MODEL: "deepseek-v4-pro" })?.model).toBe("deepseek-v4-pro");
    expect(resolveModelConfig({ DEEPSEEK_API_KEY: "k", AI_BASE_URL: "https://example.test" })?.baseURL).toBe("https://example.test");
  });

  it("treats a blank key as unset", () => {
    expect(resolveModelConfig({ DEEPSEEK_API_KEY: "   " })).toBeNull();
    expect(resolveModelConfig({})).toBeNull();
  });
});

describe("isAssistantConfigured", () => {
  it("is true only when DEEPSEEK_API_KEY is set", () => {
    expect(isAssistantConfigured({})).toBe(false);
    expect(isAssistantConfigured({ DEEPSEEK_API_KEY: "k" })).toBe(true);
    // No implicit "configured because it's on Vercel" fallback — this runs on the
    // store owner's own key, never on a hosted gateway.
    expect(isAssistantConfigured({ VERCEL: "1" })).toBe(false);
  });
});
