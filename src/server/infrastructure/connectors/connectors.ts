import "server-only";
import { classifyHttpStatus, type StepFailure } from "@/lib/engine/logic";

/**
 * Telegram, Microsoft Teams, Notion and Airtable. Every request goes to a fixed vendor host (Teams: a
 * Microsoft workflow host), redirects aren't followed, and errors become plain-language StepFailures.
 */
type Failure = StepFailure;
const fail = (f: Failure) => Object.assign(new Error(f.message), { failure: f });
const MAX_TEXT = 4000;

async function call(provider: string, url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw fail(timeout ? { code: "PROVIDER_TIMEOUT", message: `${provider} didn't respond within ${Math.round(timeoutMs / 1000)}s.`, errorClass: "transient", retryable: true } : { code: "NETWORK_ERROR", message: `Couldn't reach ${provider}.`, errorClass: "transient", retryable: true });
  }
  const text = (await res.text()).slice(0, 100_000);
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (res.status >= 300 && res.status < 400) throw fail({ code: `HTTP_${res.status}_REDIRECT`, message: `${provider} returned a redirect. Check the URL.`, errorClass: "configuration", retryable: false });
  if (!res.ok) {
    const base = classifyHttpStatus(res.status, provider);
    const detail = vendorMessage(body);
    throw fail({ ...base, message: detail ? `${base.message} ${provider} says: ${detail}` : base.message });
  }
  return { status: res.status, body };
}

function vendorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return typeof body === "string" && body.length < 300 ? body : null;
  const b = body as Record<string, unknown>;
  const m = b.description ?? b.message ?? (b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>).message : b.error);
  return typeof m === "string" ? m.slice(0, 300) : null;
}

const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/* ---------------- Telegram ---------------- */

const TG_TOKEN = /^\d{5,}:[\w-]{30,}$/;
const tg = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;

export async function telegramTest(token: string, chatId: string) {
  if (!TG_TOKEN.test(token.trim())) return { ok: false, message: "That doesn't look like a bot token. In Telegram, @BotFather gives one like 123456789:AA…" };
  const me = (await call("Telegram", tg(token.trim(), "getMe"), {}, 10_000)).body as { result?: { username?: string } };
  if (!chatId.trim()) return { ok: true, message: `Connected as @${me.result?.username}.` };
  try {
    const chat = (await call("Telegram", tg(token.trim(), "getChat"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId.trim() }) }, 10_000)).body as { result?: { title?: string; username?: string; first_name?: string } };
    return { ok: true, message: `Connected as @${me.result?.username}; can post to “${chat.result?.title ?? chat.result?.username ?? chat.result?.first_name ?? chatId}”.` };
  } catch {
    return { ok: false, message: `The bot @${me.result?.username} works, but it can't see chat ${chatId}. Add the bot to that group or channel (as an admin for channels), or message it first for a private chat.` };
  }
}

export async function telegramSend(token: string, chatId: string, text: string, timeoutMs: number) {
  if (!TG_TOKEN.test(token.trim())) throw fail({ code: "TELEGRAM_BAD_TOKEN", message: "The connection's bot token isn't valid. Rotate it with the token from @BotFather.", errorClass: "configuration", retryable: false });
  if (!text.trim()) throw fail({ code: "VALIDATION_EMPTY_MESSAGE", message: "Map a “text” input for the message.", errorClass: "validation", retryable: false });
  const r = (await call("Telegram", tg(token.trim(), "sendMessage"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId.trim(), text: text.slice(0, MAX_TEXT), disable_web_page_preview: true }) }, timeoutMs)).body as { result?: { message_id?: number } };
  return { messageId: r.result?.message_id ?? null };
}

/* ---------------- Microsoft Teams (Workflows webhook) ---------------- */

export function teamsUrlProblem(url: string): string | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return "Paste the whole webhook URL from the Teams workflow."; }
  if (u.protocol !== "https:") return "The webhook URL must start with https://.";
  if (/\.webhook\.office\.com$/.test(u.hostname)) return "That's an old Office 365 connector URL; Microsoft retired those. Create a Workflows webhook instead (see the setup steps).";
  if (!/(^|\.)(logic\.azure\.com|powerplatform\.com|powerautomate\.com|api\.powerplatform\.com)$/.test(u.hostname)) return "That isn't a Teams Workflows webhook URL. It should come from Teams → Workflows → “Post to a channel when a webhook request is received”.";
  return null;
}

export async function teamsSend(url: string, title: string, text: string, timeoutMs: number) {
  const problem = teamsUrlProblem(url);
  if (problem) throw fail({ code: "INVALID_WEBHOOK_URL", message: problem, errorClass: "configuration", retryable: false });
  if (!text.trim() && !title.trim()) throw fail({ code: "VALIDATION_EMPTY_MESSAGE", message: "Map a “text” input for the message.", errorClass: "validation", retryable: false });
  const body = [
    ...(title.trim() ? [{ type: "TextBlock", text: title.slice(0, 200), weight: "Bolder", size: "Medium", wrap: true }] : []),
    ...(text.trim() ? [{ type: "TextBlock", text: text.slice(0, MAX_TEXT), wrap: true }] : []),
  ];
  await call("Microsoft Teams", url.trim(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { type: "AdaptiveCard", $schema: "http://adaptivecards.io/schemas/adaptive-card.json", version: "1.4", body } }] }),
  }, timeoutMs);
  return { ok: true };
}

/* ---------------- Notion (API 2025-09-03: databases contain data sources) ---------------- */

const NOTION = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03";
const notionHeaders = (token: string) => ({ Authorization: `Bearer ${token.trim()}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" });

/** Accepts a database URL or ID; returns a dashed UUID. */
export function notionDatabaseId(input: string): string | null {
  const m = input.replace(/-/g, "").match(/([0-9a-f]{32})(?![0-9a-f])/i);
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type NotionProp = { id: string; type: string; name?: string };
async function notionSource(token: string, databaseId: string, timeoutMs: number) {
  const db = (await call("Notion", `${NOTION}/databases/${databaseId}`, { headers: notionHeaders(token) }, timeoutMs)).body as { title?: Array<{ plain_text?: string }>; data_sources?: Array<{ id: string; name?: string }> };
  const source = db.data_sources?.[0];
  if (!source) throw fail({ code: "NOTION_NO_SOURCE", message: "That Notion database has no data source to add rows to.", errorClass: "configuration", retryable: false });
  const ds = (await call("Notion", `${NOTION}/data_sources/${source.id}`, { headers: notionHeaders(token) }, timeoutMs)).body as { properties?: Record<string, NotionProp> };
  return { sourceId: source.id, title: db.title?.map((t) => t.plain_text).join("") || "Untitled", properties: ds.properties ?? {} };
}

export async function notionTest(token: string, databaseInput: string) {
  const id = notionDatabaseId(databaseInput);
  if (!id) return { ok: false, message: "Paste the Notion database link (Share → Copy link) or its 32-character ID." };
  try {
    const s = await notionSource(token, id, 10_000);
    return { ok: true, message: `Connected to “${s.title}”. Columns: ${Object.keys(s.properties).join(", ")}.` };
  } catch (e) {
    const f = (e as { failure?: Failure }).failure;
    if (f?.code === "HTTP_404_NOT_FOUND") return { ok: false, message: "Notion can't find that database for this integration. Open the database in Notion → ••• → Connections → add your integration." };
    return { ok: false, message: f?.message ?? (e as Error).message };
  }
}

function notionValue(type: string, name: string, v: unknown): unknown {
  const s = str(v);
  const rich = [{ type: "text", text: { content: s.slice(0, 2000) } }];
  switch (type) {
    case "title": return { title: rich };
    case "rich_text": return { rich_text: rich };
    case "number": {
      if (s.trim() === "") return { number: null };
      const n = Number(s);
      if (!Number.isFinite(n)) throw fail({ code: "NOTION_BAD_VALUE", message: `Notion column “${name}” needs a number, got “${s.slice(0, 40)}”.`, errorClass: "validation", retryable: false });
      return { number: n };
    }
    case "select": return { select: s ? { name: s.slice(0, 100) } : null };
    case "status": return { status: s ? { name: s.slice(0, 100) } : null };
    case "multi_select": return { multi_select: (Array.isArray(v) ? v.map(str) : s.split(",")).map((x) => x.trim()).filter(Boolean).map((n) => ({ name: n.slice(0, 100) })) };
    case "checkbox": return { checkbox: v === true || /^(true|yes|1|on|y)$/i.test(s.trim()) };
    case "date": {
      if (!s) return { date: null };
      if (Number.isNaN(new Date(s).getTime())) throw fail({ code: "NOTION_BAD_VALUE", message: `Notion column “${name}” needs a date, got “${s.slice(0, 40)}”.`, errorClass: "validation", retryable: false });
      return { date: { start: s } };
    }
    case "url": return { url: s || null };
    case "email": return { email: s || null };
    case "phone_number": return { phone_number: s || null };
    default:
      throw fail({ code: "NOTION_UNSUPPORTED", message: `Notion column “${name}” is a ${type.replace(/_/g, " ")} column, which can't be filled from Brightrail. Supported: title, text, number, select, multi-select, status, checkbox, date, URL, email, phone.`, errorClass: "configuration", retryable: false });
  }
}

export async function notionCreate(token: string, databaseInput: string, cells: Array<{ field: string; value: unknown }>, timeoutMs: number) {
  const id = notionDatabaseId(databaseInput);
  if (!id) throw fail({ code: "NOTION_BAD_ID", message: "The connection's Notion database link isn't valid.", errorClass: "configuration", retryable: false });
  if (!cells.length) throw fail({ code: "VALIDATION_NO_COLUMNS", message: "Add input mapping rows: Field = a Notion column name, value = what to put in it.", errorClass: "validation", retryable: false });
  const s = await notionSource(token, id, timeoutMs);
  const byName = new Map(Object.entries(s.properties).map(([n, p]) => [n.toLowerCase(), { name: n, type: p.type }]));
  const properties: Record<string, unknown> = {};
  for (const c of cells) {
    const col = byName.get(c.field.trim().toLowerCase());
    if (!col) throw fail({ code: "NOTION_UNKNOWN_COLUMN", message: `The Notion database has no column “${c.field}”. Columns: ${Object.keys(s.properties).join(", ")}.`, errorClass: "validation", retryable: false });
    properties[col.name] = notionValue(col.type, col.name, c.value);
  }
  const page = (await call("Notion", `${NOTION}/pages`, { method: "POST", headers: notionHeaders(token), body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: s.sourceId }, properties }) }, timeoutMs)).body as { id?: string; url?: string };
  return { pageId: page.id ?? null, url: page.url ?? null };
}

/* ---------------- Airtable ---------------- */

const AIRTABLE = "https://api.airtable.com/v0";

/** Accepts an Airtable URL (…/appXXX/tblYYY/…) or a base ID; the table can also be given separately. */
export function airtableTarget(baseInput: string, tableInput: string): { base: string; table: string } | null {
  const base = baseInput.match(/\b(app[A-Za-z0-9]{14})\b/)?.[1];
  const tableFromUrl = baseInput.match(/\b(tbl[A-Za-z0-9]{14})\b/)?.[1];
  const table = tableInput.trim() || tableFromUrl;
  return base && table ? { base, table } : null;
}

const airtableHeaders = (token: string) => ({ Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" });

export async function airtableTest(token: string, baseInput: string, tableInput: string) {
  const t = airtableTarget(baseInput, tableInput);
  if (!t) return { ok: false, message: "Paste the Airtable base link (it contains app…) and the table name." };
  try {
    await call("Airtable", `${AIRTABLE}/${t.base}/${encodeURIComponent(t.table)}?maxRecords=1`, { headers: airtableHeaders(token) }, 10_000);
    return { ok: true, message: `Connected to table “${t.table}”.` };
  } catch (e) {
    const f = (e as { failure?: Failure }).failure;
    if (f?.code === "HTTP_404_NOT_FOUND" || f?.code === "HTTP_403_UNAUTHORIZED")
      return { ok: false, message: "Airtable didn't allow access to that table. Give the token the scopes data.records:read and data.records:write, add this base under its Access, and check the table name." };
    return { ok: false, message: f?.message ?? (e as Error).message };
  }
}

export async function airtableCreate(token: string, baseInput: string, tableInput: string, cells: Array<{ field: string; value: unknown }>, timeoutMs: number) {
  const t = airtableTarget(baseInput, tableInput);
  if (!t) throw fail({ code: "AIRTABLE_BAD_TARGET", message: "The connection's Airtable base or table isn't set.", errorClass: "configuration", retryable: false });
  if (!cells.length) throw fail({ code: "VALIDATION_NO_COLUMNS", message: "Add input mapping rows: Field = an Airtable field name, value = what to put in it.", errorClass: "validation", retryable: false });
  const fields: Record<string, unknown> = {};
  for (const c of cells) fields[c.field.trim()] = c.value === undefined ? null : c.value;
  // typecast lets Airtable convert text to numbers, dates and select options.
  const r = (await call("Airtable", `${AIRTABLE}/${t.base}/${encodeURIComponent(t.table)}`, { method: "POST", headers: airtableHeaders(token), body: JSON.stringify({ records: [{ fields }], typecast: true }) }, timeoutMs)).body as { records?: Array<{ id: string }> };
  return { recordId: r.records?.[0]?.id ?? null };
}
