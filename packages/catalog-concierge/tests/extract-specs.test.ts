/**
 * Turning a free-text description into specs. The model call is replaced by a
 * scripted client; what is tested is the request the package makes and how
 * strictly it treats whatever comes back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/model", () => ({ getModelClient: vi.fn() }));

import { extractSpecs } from "../src/extract-specs";
import { getModelClient } from "../src/model";

const mockedGetModelClient = vi.mocked(getModelClient);

function modelReplying(content: string | null) {
  const create = vi.fn(async (_params: unknown) => ({ choices: [{ message: { content } }] }));
  mockedGetModelClient.mockReturnValue({ client: { chat: { completions: { create } } }, model: "deepseek-test" } as never);
  return create;
}

const input = { name: "Atlas Paddle", brand: "Selkirk", category: "Paddles", description: "16mm polymer core, 8.0 oz.", knownKeys: ["Core Thickness", "Weight"] };

beforeEach(() => {
  mockedGetModelClient.mockReset();
});

describe("extractSpecs", () => {
  it("returns null without calling anything when no model is configured", async () => {
    mockedGetModelClient.mockReturnValue(null);
    expect(await extractSpecs(input)).toBeNull();
  });

  it("asks for JSON with the store's known keys, and returns trimmed key/value pairs", async () => {
    const create = modelReplying(JSON.stringify({ specs: [{ key: " Core Thickness ", value: " 16mm " }, { key: "Weight", value: "8.0 oz" }] }));

    expect(await extractSpecs(input)).toEqual({ "Core Thickness": "16mm", Weight: "8.0 oz" });

    const request = create.mock.calls[0]![0] as { model: string; response_format: unknown; messages: { role: string; content: string }[] };
    expect(request.model).toBe("deepseek-test");
    expect(request.response_format).toEqual({ type: "json_object" });
    const user = request.messages.find((m) => m.role === "user")!.content;
    expect(user).toContain("Product: Atlas Paddle");
    expect(user).toContain("Brand: Selkirk");
    expect(user).toContain("Category: Paddles");
    expect(user).toContain("Known spec keys in this store: Core Thickness, Weight");
    expect(user).toContain("16mm polymer core, 8.0 oz.");
  });

  it("leaves out lines for details the product does not have", async () => {
    const create = modelReplying(JSON.stringify({ specs: [] }));
    await extractSpecs({ name: "Mystery", description: "Just a thing." });
    const user = (create.mock.calls[0]![0] as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === "user")!.content;
    expect(user).not.toContain("Brand:");
    expect(user).not.toContain("Category:");
    expect(user).not.toContain("Known spec keys");
  });

  it("returns null rather than guessing when the reply is unusable", async () => {
    for (const content of [null, "", "not json", JSON.stringify({ specs: [{ key: "", value: "x" }] }), JSON.stringify({ wrong: [] }), JSON.stringify({ specs: Array.from({ length: 31 }, (_, i) => ({ key: `K${i}`, value: "v" })) })]) {
      modelReplying(content);
      expect(await extractSpecs(input), String(content)).toBeNull();
    }
  });
});
