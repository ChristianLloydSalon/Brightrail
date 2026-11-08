// @vitest-environment node
// Regression tests: emailed sign-in links are bound to the browser that requested them (login CSRF).
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (name: string, value: string) => jar.set(name, value), get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("./supabase", () => ({ adminClient: () => ({}), userClient: async () => ({}) }));
vi.mock("./env", () => ({ env: { appUrl: "https://app.example", resendApiKey: "", emailFrom: "" } }));

const { LINK_COOKIE, bindLinkToThisBrowser, callbackLink, linkMatchesBrowser } = await import("./auth-emails");
const { destinationAfterLink } = await import("./auth-links");

describe("email link binding", () => {
  it("matches only the browser that asked for the link", async () => {
    const binding = await bindLinkToThisBrowser();
    const cookie = jar.get(LINK_COOKIE);
    expect(linkMatchesBrowser(binding, cookie)).toBe(true);
    expect(linkMatchesBrowser(binding, undefined)).toBe(false); // opened in another browser
    expect(linkMatchesBrowser(null, cookie)).toBe(false); // unbound link (e.g. invitation)
    expect(linkMatchesBrowser(binding, "someone-elses-cookie")).toBe(false);
    expect(new URL(callbackLink("hash", "recovery", undefined, binding)).searchParams.get("b")).toBe(binding);
  });

  it("never redirects off-site after a link", () => {
    expect(destinationAfterLink(true, "magiclink", "/\\evil.example")).toBe("/dashboard");
    expect(destinationAfterLink(true, "recovery", "/anything")).toBe("/reset-password");
    expect(destinationAfterLink(false, "signup", "/onboarding")).toBe("/sign-in?error=link");
  });
});
