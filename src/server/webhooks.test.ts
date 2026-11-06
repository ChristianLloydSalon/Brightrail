// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./supabase", () => ({ adminClient: () => { throw new Error("no db in unit tests"); } }));
vi.mock("./engine/runs", () => ({ startRun: vi.fn() }));
const { formToObject } = await import("./webhooks");

describe("form-encoded webhook bodies", () => {
  it("parses fields, repeats and encoding; drops prototype keys", () => {
    expect(formToObject("name=Ada+Lovelace&email=ada%40example.com&tag=a&tag=b&__proto__=x&constructor=y")).toEqual({ name: "Ada Lovelace", email: "ada@example.com", tag: ["a", "b"] });
    expect(Object.getPrototypeOf(formToObject("__proto__[admin]=1"))).toBe(Object.prototype);
  });
});
