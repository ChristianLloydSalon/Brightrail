// @vitest-environment node
// Regression tests for the November 2026 security audit (see ~/security-audit-skill/flowforge/run-1).
import { describe, expect, it } from "vitest";
import { can } from "./permissions";
import { REDACTED, redact } from "./redaction";
import { isPrivateAddress } from "./url-safety";
import { fillJsonTemplate, fillTemplate, runContextFrom } from "@/lib/engine/logic";
import { safeLocalPath } from "@/lib/navigation";

describe("redaction of credential headers", () => {
  it("masks X-API-Key and other prefixed credential headers", () => {
    const out = redact({ headers: { "X-API-Key": "dummy-secret-123", "x-auth-token": "t", Authorization: "Bearer x" } }) as { headers: Record<string, string> };
    expect(out.headers["X-API-Key"]).toBe(REDACTED);
    expect(out.headers["x-auth-token"]).toBe(REDACTED);
    expect(out.headers.Authorization).toBe(REDACTED);
  });
});

describe("HTTP template encoding", () => {
  it("keeps run data inside the JSON string it was placed in", () => {
    const body = fillJsonTemplate('{"role":"user","note":"{{note}}"}', { note: 'hi","role":"admin' });
    expect(JSON.parse(body)).toEqual({ role: "user", note: 'hi","role":"admin' });
  });
  it("inserts bare placeholders as JSON values, not raw text", () => {
    expect(JSON.parse(fillJsonTemplate('{"amount":{{amount}}}', { amount: '1,"refund":true' }))).toEqual({ amount: '1,"refund":true' });
    expect(JSON.parse(fillJsonTemplate('{"amount":{{amount}},"ok":{{ok}}}', { amount: "42", ok: true }))).toEqual({ amount: 42, ok: true });
    expect(JSON.parse(fillJsonTemplate('{"items":{{items}},"missing":{{nope}}}', { items: [1, 2] }))).toEqual({ items: [1, 2], missing: null });
    expect(JSON.parse(fillJsonTemplate('{"escaped":"a\\"{{x}}"}', { x: "b" }))).toEqual({ escaped: 'a"b' });
  });
  it("percent-encodes run data in URLs so it can't change the path", () => {
    const url = fillTemplate("https://api.example.com/orders/{{orderId}}", { orderId: "../admin/users?delete=1#" }, encodeURIComponent);
    expect(new URL(url).pathname.startsWith("/orders/")).toBe(true);
    expect(new URL(url).search).toBe("");
  });
});

describe("post-sign-in redirect guard", () => {
  it.each(["/\\evil.example", "/%5Cevil.example".replace("%5C", "\\"), "/\t/evil.example", "//evil.example", "https://evil.example", "", null])("rejects %j", (v) => {
    expect(safeLocalPath(v as string | null)).toBe("/dashboard");
  });
  it("keeps same-site paths with query and hash", () => {
    expect(safeLocalPath("/workflows/abc?tab=runs#top")).toBe("/workflows/abc?tab=runs#top");
  });
});

describe("configurable grants", () => {
  it("ignores grant keys outside the configurable set", () => {
    expect(can("admin", "workspace.delete", { "admin:workspace.delete": true } as never)).toBe(false);
    expect(can("viewer", "apikeys.manage", { "viewer:apikeys.manage": true } as never)).toBe(false);
    expect(can("viewer", "audit.view", { "viewer:audit.view": true })).toBe(true);
  });
});

describe("outbound address blocklist", () => {
  it.each(["127.0.0.1", "10.1.2.3", "169.254.169.254", "198.18.0.1", "192.0.0.8", "224.0.0.1", "::1", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1", "fd00::1", "fe90::1", "fec0::1", "ff02::1"])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(["93.184.216.34", "2606:4700:4700::1111", "2002:5db8:d822::1"])("allows %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("run context", () => {
  it("doesn't let payload keys overwrite engine-owned names", () => {
    const ctx = runContextFrom({ orderId: "7", trigger: { orderId: "1" }, steps: { charge: { status: 200 } }, __scope: "x" });
    expect(ctx.trigger).toEqual({ orderId: "7", trigger: { orderId: "1" }, steps: { charge: { status: 200 } }, __scope: "x" });
    expect(ctx.steps).toEqual({});
    expect(ctx.__scope).toBeUndefined();
    expect(ctx.orderId).toBe("7");
  });
});
