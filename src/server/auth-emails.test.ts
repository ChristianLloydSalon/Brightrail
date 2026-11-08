// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }) }));
const hits = new Map<string, number>();
vi.mock("./supabase", () => ({ adminClient: () => ({ rpc: async (_: string, { p_key }: { p_key: string }) => { hits.set(p_key, (hits.get(p_key) ?? 0) + 1); return { data: hits.get(p_key), error: null }; } }) }));
vi.mock("./env", () => ({ env: { appUrl: "https://app.example.com", resendApiKey: "re_test", emailFrom: "Brightrail <a@b.co>" } }));
const m = await import("./auth-emails");
afterEach(() => vi.unstubAllGlobals());

describe("auth emails", () => {
  it("builds callback links on the app's own domain", () => {
    const u = new URL(m.callbackLink("abc123", "invite", "/reset-password?invited=1"));
    expect(u.origin).toBe("https://app.example.com");
    expect(u.pathname).toBe("/auth/callback");
    expect(Object.fromEntries(u.searchParams)).toEqual({ token_hash: "abc123", type: "invite", next: "/reset-password?invited=1" });
  });

  it("escapes HTML and sends an idempotency key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status: 200 }); }));
    await m.sendEmail("x@y.co", "Hi", ['<script>alert("x")</script> invited you'], { label: "Go", url: "https://app.example.com/a?b=1&c=2" }, "k1");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("b=1&amp;c=2");
    expect((calls[0]!.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("k1");
  });

  it("limits each address to 3 emails an hour and each IP to 20", async () => {
    for (let i = 0; i < 3; i++) await m.throttleAuthEmail("recovery", "A@x.co");
    await expect(m.throttleAuthEmail("recovery", "a@x.co")).rejects.toThrow(/Too many emails/);
    expect(hits.get("ip:203.0.113.9")).toBe(3); // the 4th was stopped by the per-address limit first
    hits.set("ip:203.0.113.9", 20);
    await expect(m.throttleAuthEmail("signup", "new@x.co")).rejects.toThrow(/Too many emails/);
  });
});
