import { describe, expect, it } from "vitest";
import { isAssistantConfigured, resolveAiConfig } from "@/lib/ai/client";

describe("resolveAiConfig", () => {
  it("prefers a direct Anthropic key", () => {
    expect(resolveAiConfig({ ANTHROPIC_API_KEY: "sk-ant-x", VERCEL_OIDC_TOKEN: "oidc" })).toMatchObject({ provider: "anthropic", model: "claude-opus-5", apiKey: "sk-ant-x" });
  });
  it("falls back to the Vercel AI Gateway with a prefixed model id", () => {
    expect(resolveAiConfig({ AI_GATEWAY_API_KEY: "vck_x" })).toMatchObject({ provider: "vercel-gateway", model: "anthropic/claude-opus-5", baseURL: "https://ai-gateway.vercel.sh" });
    expect(resolveAiConfig({ VERCEL_OIDC_TOKEN: "eyJ" })?.provider).toBe("vercel-gateway");
  });
  it("honours AI_MODEL and does not double-prefix", () => {
    expect(resolveAiConfig({ AI_GATEWAY_API_KEY: "k", AI_MODEL: "claude-sonnet-5" })?.model).toBe("anthropic/claude-sonnet-5");
    expect(resolveAiConfig({ AI_GATEWAY_API_KEY: "k", AI_MODEL: "anthropic/claude-sonnet-5" })?.model).toBe("anthropic/claude-sonnet-5");
    expect(resolveAiConfig({ ANTHROPIC_API_KEY: "k", AI_MODEL: "claude-sonnet-5" })?.model).toBe("claude-sonnet-5");
  });
  it("returns null with no credentials", () => {
    expect(resolveAiConfig({})).toBeNull();
    expect(resolveAiConfig({ ANTHROPIC_API_KEY: "  " })).toBeNull();
  });
  it("treats a Vercel deployment as configured (OIDC token arrives per request)", () => {
    expect(isAssistantConfigured({})).toBe(false);
    expect(isAssistantConfigured({ VERCEL: "1" })).toBe(true);
    expect(isAssistantConfigured({ ANTHROPIC_API_KEY: "k" })).toBe(true);
  });
});
