/**
 * The streaming route. It is a public POST endpoint that spends money, so the
 * tests are mostly about what it refuses, and about the one thing the Server
 * Action cannot do: say what the assistant is doing while it does it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn(), cookies: vi.fn() }));
vi.mock("@/lib/tenant/current", () => ({ requireCurrentTenant: vi.fn(), getTenantDb: vi.fn() }));
vi.mock("@/lib/ai/prisma-adapter", () => ({ createPrismaCatalogAdapter: vi.fn(() => ({ fakeAdapter: true })) }));
// Which sites may embed this store's assistant, without a whole environment.
vi.mock("@/lib/env", () => ({ env: () => ({ ASSISTANT_ALLOWED_ORIGINS: "https://client.example" }), isProduction: () => false }));
vi.mock("catalog-concierge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("catalog-concierge")>()),
  askConciergeStream: vi.fn(),
  isAssistantConfigured: vi.fn(),
}));

import { askConciergeStream, isAssistantConfigured, type ConciergeEvent, type ConciergeReply } from "catalog-concierge";
import { cookies, headers } from "next/headers";
import { OPTIONS, POST } from "@/app/api/assistant/route";
import { rateLimitStore } from "@/lib/auth/rate-limit";
import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

const tenant = { id: "t-acme", name: "Selkirk Demo", assistantEnabled: true, assistantName: "Fit Assistant", currency: "MYR", locale: "en-MY", country: "MY", assistantPolicies: null };
const SESSION = "0123456789abcdef0123456789abcdef";

const reply: ConciergeReply = {
  answer: "Try the Atlas.",
  suggestions: ["Compare them"],
  products: [{ ref: "PAD-1", name: "Atlas", url: "/products/atlas", imageUrl: null, price: 22090, priceFrom: false, priceLabel: "RM 220.90", stockLabel: "In stock" }],
  origin: { kind: "model", toolCalls: ["search_products"] },
};

/** The route's answer, as the browser reads it: one JSON object per line. */
async function lines(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const ask = (body: unknown, init: RequestInit = {}) =>
  POST(new Request("http://demo.localhost:3000/api/assistant", { method: "POST", headers: { "content-type": "application/json", ...(init.headers ?? {}) }, body: JSON.stringify(body) }));

function streamOf(events: ConciergeEvent[], result: ConciergeReply = reply) {
  return vi.mocked(askConciergeStream).mockImplementation(
    async function* () {
      for (const event of events) yield event;
      return result;
    } as unknown as typeof askConciergeStream,
  );
}

let db: { chatConversation: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }; product: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> } };

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitStore.reset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = {
    chatConversation: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})), create: vi.fn(async () => ({})) },
    product: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
  };
  vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => ({ name: "zy_chat_session", value: SESSION })), set: vi.fn() } as never);
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "demo.localhost:3000", "x-forwarded-for": "198.51.100.1" }) as never);
  vi.mocked(requireCurrentTenant).mockResolvedValue(tenant as never);
  vi.mocked(getTenantDb).mockResolvedValue(db as never);
  vi.mocked(isAssistantConfigured).mockReturnValue(true);
  streamOf([{ kind: "tool", name: "search_products" }]);
});

describe("POST /api/assistant — answering as it works", () => {
  it("reports each tool before the answer, and logs the exchange", async () => {
    const response = await ask({ message: "which paddle?" });

    expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await lines(response)).toEqual([
      { type: "status", tool: "search_products" },
      { type: "reply", result: { ok: true, answer: "Try the Atlas.", suggestions: ["Compare them"], products: reply.products } },
    ]);
    expect(db.chatConversation.create).toHaveBeenCalledTimes(1);
  });

  it("streams the answer as the model writes it, then the finished reply", async () => {
    vi.mocked(askConciergeStream).mockImplementation(
      (async function* () {
        yield { kind: "tool", name: "search_products" };
        yield { kind: "answer", delta: "Try the " };
        yield { kind: "answer", delta: "Atlas." };
        return reply;
      }) as unknown as typeof askConciergeStream,
    );

    expect(await lines(await ask({ message: "which paddle?" }))).toEqual([
      { type: "status", tool: "search_products" },
      { type: "answer", delta: "Try the " },
      { type: "answer", delta: "Atlas." },
      { type: "reply", result: { ok: true, answer: "Try the Atlas.", suggestions: ["Compare them"], products: reply.products } },
    ]);
  });

  it("asks the package to stream, which a Server Action cannot do", async () => {
    await lines(await ask({ message: "which paddle?" }));

    expect(askConciergeStream).toHaveBeenCalledWith(expect.objectContaining({ streamAnswer: true }), expect.anything());
  });

  it("tells the assistant which product page the question came from", async () => {
    db.product.findFirst.mockResolvedValueOnce({ sku: "PAD-1" });

    await lines(await ask({ message: "is this any good?", path: "/products/slk-atlas-max" }));

    expect(askConciergeStream).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ viewing: "PAD-1" }));
  });

  it("refuses a request from a site the store has not listed, before doing any work", async () => {
    const response = await ask({ message: "which paddle?" }, { headers: { origin: "https://evil.example" } });

    expect(await lines(response)).toEqual([{ type: "reply", result: { ok: false, error: "This request did not come from the store." } }]);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(requireCurrentTenant).not.toHaveBeenCalled();
    expect(askConciergeStream).not.toHaveBeenCalled();
  });

  // The <script> embed lives on the client's own site, so the answer has to
  // carry cross-origin headers and the thread has to survive between messages.
  it("answers a site the store listed, with the headers a browser needs", async () => {
    const response = await ask({ message: "which paddle?" }, { headers: { origin: "https://client.example" } });

    expect(response.headers.get("access-control-allow-origin")).toBe("https://client.example");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("vary")).toBe("origin");
    expect(await lines(response)).toHaveLength(2);
  });

  it("answers the browser's preflight for a listed site, and refuses one for anybody else", async () => {
    const allowed = await OPTIONS(new Request("http://demo.localhost:3000/api/assistant", { method: "OPTIONS", headers: { origin: "https://client.example" } }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");

    const refused = await OPTIONS(new Request("http://demo.localhost:3000/api/assistant", { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(refused.status).toBe(403);
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses an Origin that is not even a URL", async () => {
    const response = await ask({ message: "which paddle?" }, { headers: { origin: "not-a-url" } });

    expect(await lines(response)).toEqual([{ type: "reply", result: { ok: false, error: "This request did not come from the store." } }]);
  });

  it("accepts the store's own origin", async () => {
    const response = await ask({ message: "which paddle?" }, { headers: { origin: "http://demo.localhost:3000" } });

    expect(await lines(response)).toHaveLength(2);
  });

  it("refuses an empty message, a store with the assistant off, and an unconfigured deployment", async () => {
    expect(await lines(await ask({ message: "   " }))).toEqual([{ type: "reply", result: { ok: false, error: "Please enter a message (up to 1000 characters)." } }]);

    vi.mocked(requireCurrentTenant).mockResolvedValueOnce({ ...tenant, assistantEnabled: false } as never);
    expect(await lines(await ask({ message: "hi" }))).toEqual([{ type: "reply", result: { ok: false, error: "The assistant is turned off for this store." } }]);

    vi.mocked(isAssistantConfigured).mockReturnValueOnce(false);
    expect(await lines(await ask({ message: "hi" }))).toEqual([{ type: "reply", result: { ok: false, error: "The assistant is not configured yet." } }]);

    expect(askConciergeStream).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON at all", async () => {
    const response = await POST(new Request("http://demo.localhost:3000/api/assistant", { method: "POST", body: "{not json" }));

    expect(await lines(response)).toEqual([{ type: "reply", result: { ok: false, error: "Please enter a message (up to 1000 characters)." } }]);
  });

  it("stops a session that is asking too fast", async () => {
    for (let i = 0; i < 30; i++) await lines(await ask({ message: "which paddle?" }));

    expect(await lines(await ask({ message: "which paddle?" }))).toEqual([
      { type: "reply", result: { ok: false, error: "You're sending messages quickly — please wait a few minutes and try again." } },
    ]);
  });

  it("ends the stream with words a customer can act on when the model fails", async () => {
    vi.mocked(askConciergeStream).mockImplementation(
        (async function* () {
        yield { kind: "tool", name: "search_products" };
        throw new Error("model exploded");
      }) as unknown as typeof askConciergeStream,
    );

    expect(await lines(await ask({ message: "which paddle?" }))).toEqual([
      { type: "status", tool: "search_products" },
      { type: "reply", result: { ok: false, error: "Something went wrong while answering. Please try again." } },
    ]);
    expect(console.error).toHaveBeenCalled();
    expect(db.chatConversation.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/assistant — the rest of a conversation", () => {
  const thread = {
    id: "c-1",
    messageCount: 2,
    messages: [
      { role: "user", content: "which paddle?" },
      { role: "assistant", content: "The Atlas.", suggestions: ["Compare them"], productSkus: ["PAD-1"] },
    ],
  };

  it("hands back the stored conversation, with its cards", async () => {
    db.chatConversation.findUnique.mockResolvedValueOnce(thread);
    db.product.findMany.mockResolvedValueOnce([{ sku: "PAD-1", name: "Atlas", slug: "atlas", price: 22090, hasVariants: false, stockQuantity: 12, lowStockThreshold: 5, images: [] }]);

    const response = await ask({ action: "history" });

    expect(response.headers.get("content-type")).toContain("application/json");
    const payload = (await response.json()) as { messages: Array<Record<string, unknown>> };
    expect(payload.messages[1]).toMatchObject({ role: "assistant", content: "The Atlas.", products: [{ ref: "PAD-1" }] });
  });

  it("records a rating against the answer it belongs to", async () => {
    db.chatConversation.findUnique.mockResolvedValueOnce(thread);

    expect(await (await ask({ action: "feedback", answer: "The Atlas.", rating: "down" })).json()).toEqual({ ok: true });

    const written = (db.chatConversation.update.mock.calls[0]![0] as { data: { messages: Array<Record<string, unknown>> } }).data.messages;
    expect(written[1]).toMatchObject({ rating: "down" });
  });

  it("says ok to a rating it could not use, because the customer has already been thanked", async () => {
    db.chatConversation.findUnique.mockResolvedValueOnce(null);

    expect(await (await ask({ action: "feedback", answer: "Something it never said.", rating: "up" })).json()).toEqual({ ok: true });
    expect(db.chatConversation.update).not.toHaveBeenCalled();
  });

  it("starts a new thread, with a cookie the browser will keep across sites", async () => {
    const jar = { get: vi.fn(() => ({ name: "zy_chat_session", value: SESSION })), set: vi.fn() };
    vi.mocked(cookies).mockResolvedValue(jar as never);

    expect(await (await ask({ action: "new-chat" }, { headers: { origin: "https://client.example" } })).json()).toEqual({ ok: true });

    const [name, token, options] = jar.set.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(name).toBe("zy_chat_session");
    expect(token).not.toBe(SESSION);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "none", secure: true });
  });

  it("keeps a same-site new chat on a lax cookie", async () => {
    const jar = { get: vi.fn(() => ({ name: "zy_chat_session", value: SESSION })), set: vi.fn() };
    vi.mocked(cookies).mockResolvedValue(jar as never);

    await ask({ action: "new-chat" });

    expect(jar.set.mock.calls[0]![2]).toMatchObject({ sameSite: "lax" });
  });

  it("refuses an action it does not know, and never reaches the model", async () => {
    const response = await ask({ action: "delete-everything" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Unknown action." });
    expect(askConciergeStream).not.toHaveBeenCalled();
  });

  it("refuses every action from a site the store has not listed", async () => {
    for (const action of ["history", "feedback", "new-chat"]) {
      const response = await ask({ action }, { headers: { origin: "https://evil.example" } });
      expect(await lines(response), action).toEqual([{ type: "reply", result: { ok: false, error: "This request did not come from the store." } }]);
    }
  });
});
