// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const c = await import("./connectors");

type Call = { url: string; init: RequestInit };
function mock(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => { const call = { url, init }; calls.push(call); return handler(call); }));
  return calls;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const body = (call: Call) => JSON.parse(String(call.init.body));
afterEach(() => vi.unstubAllGlobals());

describe("Telegram", () => {
  const token = "123456789:AAH-abcdefghijklmnopqrstuvwxyz123456";
  it("checks the token and that the bot can see the chat", async () => {
    expect((await c.telegramTest("nope", "1")).message).toMatch(/BotFather/);
    mock(({ url }) => (url.endsWith("/getMe") ? json({ ok: true, result: { username: "ff_bot" } }) : json({ ok: false, description: "Bad Request: chat not found" }, 400)));
    const r = await c.telegramTest(token, "-100123");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/@ff_bot works, but it can't see chat -100123/);
  });
  it("sends plain text to the chat", async () => {
    const calls = mock(() => json({ ok: true, result: { message_id: 42 } }));
    expect(await c.telegramSend(token, "-100123", "Hello", 5000)).toEqual({ messageId: 42 });
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(body(calls[0]!)).toMatchObject({ chat_id: "-100123", text: "Hello" });
  });
});

describe("Microsoft Teams", () => {
  it("accepts Workflows URLs and rejects retired connector URLs", () => {
    expect(c.teamsUrlProblem("https://prod-12.westus.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?sig=x")).toBeNull();
    expect(c.teamsUrlProblem("https://default123.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/x")).toBeNull();
    expect(c.teamsUrlProblem("https://contoso.webhook.office.com/webhookb2/x")).toMatch(/retired/);
    expect(c.teamsUrlProblem("https://evil.example.com/hook")).toMatch(/isn't a Teams/);
  });
  it("posts an Adaptive Card", async () => {
    const calls = mock(() => new Response("", { status: 202 }));
    await c.teamsSend("https://prod-1.westus.logic.azure.com/workflows/x", "Run failed", "Order sync failed", 5000);
    const card = body(calls[0]!);
    expect(card.type).toBe("message");
    expect(card.attachments[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(card.attachments[0].content.body.map((b: { text: string }) => b.text)).toEqual(["Run failed", "Order sync failed"]);
  });
});

describe("Notion", () => {
  const db = "https://www.notion.so/acme/Leads-0123456789abcdef0123456789abcdef?v=fedcba9876543210fedcba9876543210";
  it("parses database links", () => {
    expect(c.notionDatabaseId(db)).toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(c.notionDatabaseId("not a link")).toBeNull();
  });
  it("finds the data source, maps columns by type and creates the page", async () => {
    const calls = mock(({ url, init }) => {
      if (url.includes("/databases/")) return json({ title: [{ plain_text: "Leads" }], data_sources: [{ id: "ds_1", name: "Leads" }] });
      if (url.includes("/data_sources/")) return json({ properties: { Name: { id: "a", type: "title" }, Amount: { id: "b", type: "number" }, Tags: { id: "c", type: "multi_select" }, Done: { id: "d", type: "checkbox" }, Owner: { id: "e", type: "people" } } });
      if (url.endsWith("/pages") && init.method === "POST") return json({ id: "page_1", url: "https://notion.so/page_1" });
      return json({}, 404);
    });
    const r = await c.notionCreate("ntn_x", db, [{ field: "name", value: "Ada" }, { field: "Amount", value: "12.5" }, { field: "Tags", value: "vip, eu" }, { field: "done", value: "yes" }], 5000);
    expect(r).toEqual({ pageId: "page_1", url: "https://notion.so/page_1" });
    const page = body(calls.find((x) => x.url.endsWith("/pages"))!);
    expect(page.parent).toEqual({ type: "data_source_id", data_source_id: "ds_1" });
    expect(page.properties).toEqual({ Name: { title: [{ type: "text", text: { content: "Ada" } }] }, Amount: { number: 12.5 }, Tags: { multi_select: [{ name: "vip" }, { name: "eu" }] }, Done: { checkbox: true } });
    expect((calls[0]!.init.headers as Record<string, string>)["Notion-Version"]).toBe("2025-09-03");
    await expect(c.notionCreate("ntn_x", db, [{ field: "Owner", value: "x" }], 5000)).rejects.toThrow(/people column/);
    await expect(c.notionCreate("ntn_x", db, [{ field: "Nope", value: "x" }], 5000)).rejects.toThrow(/no column “Nope”/);
    await expect(c.notionCreate("ntn_x", db, [{ field: "Amount", value: "abc" }], 5000)).rejects.toThrow(/needs a number/);
  });
});

describe("Airtable", () => {
  it("parses base links and creates a typecast record", async () => {
    expect(c.airtableTarget("https://airtable.com/appAbCdEfGhIjKlMn/tblAbCdEfGhIjKlMn/viwX", "")).toEqual({ base: "appAbCdEfGhIjKlMn", table: "tblAbCdEfGhIjKlMn" });
    expect(c.airtableTarget("appAbCdEfGhIjKlMn", "Leads")).toEqual({ base: "appAbCdEfGhIjKlMn", table: "Leads" });
    const calls = mock(() => json({ records: [{ id: "rec1" }] }));
    expect(await c.airtableCreate("pat_x", "appAbCdEfGhIjKlMn", "My Leads", [{ field: "Email", value: "a@b.co" }], 5000)).toEqual({ recordId: "rec1" });
    expect(calls[0]!.url).toBe("https://api.airtable.com/v0/appAbCdEfGhIjKlMn/My%20Leads");
    expect(body(calls[0]!)).toEqual({ records: [{ fields: { Email: "a@b.co" } }], typecast: true });
  });
  it("explains permission problems and passes vendor messages through", async () => {
    mock(() => json({ error: { type: "INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND", message: "Invalid permissions" } }, 403));
    expect((await c.airtableTest("pat_x", "appAbCdEfGhIjKlMn", "Leads")).message).toMatch(/data\.records:read/);
    mock(() => json({ error: { type: "UNKNOWN_FIELD_NAME", message: "Unknown field name: \"Emial\"" } }, 422));
    await expect(c.airtableCreate("pat_x", "appAbCdEfGhIjKlMn", "Leads", [{ field: "Emial", value: "x" }], 5000)).rejects.toThrow(/Unknown field name/);
  });
});
