import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, getModelClient, isAssistantConfigured, resolveModelConfig } from "../src/model";

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

describe("getModelClient", () => {
  it("returns null when no key is set", () => {
    expect(getModelClient({})).toBeNull();
  });

  it("reuses one client for the same credentials and builds a new one when they change", () => {
    const a = getModelClient({ DEEPSEEK_API_KEY: "key-one" });
    const b = getModelClient({ DEEPSEEK_API_KEY: "key-one" });
    expect(a?.model).toBe(DEFAULT_MODEL);
    expect(b?.client).toBe(a?.client);

    const c = getModelClient({ DEEPSEEK_API_KEY: "key-two" });
    expect(c?.client).not.toBe(a?.client);

    const d = getModelClient({ DEEPSEEK_API_KEY: "key-two", AI_BASE_URL: "https://example.test/v1", AI_MODEL: "deepseek-v4-pro" });
    expect(d?.client).not.toBe(c?.client);
    expect(d?.client.baseURL).toBe("https://example.test/v1");
    expect(d?.model).toBe("deepseek-v4-pro");
  });
});
