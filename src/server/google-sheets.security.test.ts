// @vitest-environment node
// Regression test: a cached Google token must not be handed to a caller who only knows the
// service account's (public) client_email (November 2026 security audit).
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { describeSpreadsheet } = await import("./google-sheets");

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const victim = { client_email: "victim@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const forged = { client_email: victim.client_email, private_key: "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----" };
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

afterEach(() => vi.unstubAllGlobals());

describe("Google token cache", () => {
  it("does not reuse another key's token for the same client_email", async () => {
    const sheetAuth: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "victim-token", expires_in: 3600 }), { status: 200 });
      sheetAuth.push(String((init.headers as Record<string, string>).Authorization));
      return new Response(JSON.stringify({ properties: { title: "Victim sheet" }, sheets: [] }), { status: 200 });
    }));
    await expect(describeSpreadsheet(victim, SHEET)).resolves.toMatchObject({ title: "Victim sheet" });
    // Same client_email, wrong key: must try (and fail) to sign rather than get the cached token.
    await expect(describeSpreadsheet(forged, SHEET)).rejects.toMatchObject({ failure: { code: "SHEETS_BAD_KEY" } });
    expect(sheetAuth).toEqual(["Bearer victim-token"]);
  });
});
