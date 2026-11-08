// @vitest-environment node
import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { appendRow, describeSpreadsheet, parseServiceAccount, spreadsheetIdFrom } = await import("./google-sheets");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keyFile = JSON.stringify({ type: "service_account", client_email: "bot@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), private_key_id: "abcd1234", token_uri: "https://evil.example/token" });
const sa = parseServiceAccount(keyFile) as { client_email: string; private_key: string };
const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

type Call = { url: string; init: RequestInit };
function mockGoogle(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { const c = { url: decodeURIComponent(url), init }; calls.push(c); return handler(c); }));
  return calls;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("Google Sheets connector", () => {
  it("validates the key file and sheet URL", () => {
    expect("error" in (parseServiceAccount("not json") as object)).toBe(true);
    expect((parseServiceAccount(JSON.stringify({ type: "authorized_user" })) as { error: string }).error).toMatch(/service account/);
    expect(sa.client_email).toBe("bot@proj.iam.gserviceaccount.com");
    expect(spreadsheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID);
    expect(spreadsheetIdFrom(ID)).toBe(ID);
    expect(spreadsheetIdFrom("https://example.com/sheet")).toBeNull();
  });

  it("signs a valid RS256 JWT, only talks to Google hosts, and appends RAW values by header name", async () => {
    const calls = mockGoogle(({ url }) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "tok", expires_in: 3600 });
      if (url.includes("!1:1")) return json({ values: [["Name", "Email", "ID"]] });
      if (url.includes(":append")) return json({ updates: { updatedRange: "'Leads'!A5:C5", updatedRows: 1 } });
      return json({}, 404);
    });
    const res = await appendRow(sa, ID, "Leads", [{ field: "email", value: "a@b.co" }, { field: "ID", value: 7 }, { field: "A", value: "=IMPORTXML(\"x\")" }], 5000);
    expect(res.updatedRange).toBe("'Leads'!A5:C5");
    expect(calls.every((c) => /^https:\/\/(oauth2|sheets)\.googleapis\.com\//.test(c.url))).toBe(true); // token_uri in the key is ignored

    const assertion = new URLSearchParams(String(calls[0]!.init.body)).get("assertion")!;
    const [h, p, sig] = assertion.split(".");
    expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, sig!, "base64url")).toBe(true);
    expect(JSON.parse(Buffer.from(p!, "base64url").toString())).toMatchObject({ iss: sa.client_email, aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/spreadsheets" });

    const append = calls.find((c) => c.url.includes(":append"))!;
    expect(append.url).toContain("valueInputOption=RAW");
    // "ID" header wins over column letter ID; "A" falls back to column A.
    expect(JSON.parse(String(append.init.body))).toEqual({ values: [["=IMPORTXML(\"x\")", "a@b.co", "7"]] });
  });

  it("explains sharing problems and unknown columns", async () => {
    mockGoogle(({ url }) => (url.includes("token") ? json({ access_token: "tok2", expires_in: 3600 }) : json({ error: { message: "The caller does not have permission" } }, 403)));
    await expect(describeSpreadsheet({ ...sa, client_email: "other@proj.iam.gserviceaccount.com" }, ID)).rejects.toThrow(/Share it with other@proj\.iam\.gserviceaccount\.com/);

    mockGoogle(({ url }) => (url.includes("!1:1") ? json({ values: [["Name"]] }) : json({ access_token: "tok", expires_in: 3600 })));
    await expect(appendRow(sa, ID, "Sheet1", [{ field: "Phone number", value: "1" }], 5000)).rejects.toThrow(/No column named “Phone number”/);
  });
});
