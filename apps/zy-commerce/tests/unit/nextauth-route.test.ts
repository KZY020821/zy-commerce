import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ handlers: { GET: "auth-js-get", POST: "auth-js-post" } }));

import { GET, POST } from "@/app/api/auth/[...nextauth]/route";

describe("/api/auth/[...nextauth]", () => {
  it("serves Auth.js's own handlers and nothing else", () => {
    expect(GET).toBe("auth-js-get");
    expect(POST).toBe("auth-js-post");
  });
});
