import "server-only";
import { createHash, createSign } from "node:crypto";
import { parseServiceAccount, spreadsheetIdFrom, type ServiceAccount } from "@/lib/integrations/google-sheets-format";

/**
 * Google Sheets via a service account (no OAuth consent screen needed).
 * The person shares their spreadsheet with the service account's email, like sharing with a colleague.
 * Hosts are fixed (oauth2.googleapis.com, sheets.googleapis.com); nothing in the key file can redirect requests.
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export { parseServiceAccount, spreadsheetIdFrom, type ServiceAccount };

type Failure = { code: string; message: string; errorClass: "transient" | "permission" | "validation" | "configuration"; retryable: boolean };
const fail = (f: Failure) => Object.assign(new Error(f.message), { failure: f });

const tokens = new Map<string, { token: string; exp: number }>();
const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
/**
 * Cache key bound to the private key itself, not just the (public) client_email: otherwise anyone who
 * pastes another tenant's client_email with a dummy key would be handed that tenant's cached token.
 */
const cacheKey = (sa: ServiceAccount) => createHash("sha256").update(sa.client_email).update("\0").update(sa.private_key).digest("hex");

async function accessToken(sa: ServiceAccount, timeoutMs: number): Promise<string> {
  const key = cacheKey(sa);
  const cached = tokens.get(key);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }))}`;
  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  } catch {
    throw fail({ code: "SHEETS_BAD_KEY", message: "The service account private key couldn't be read. Paste the JSON key file again.", errorClass: "configuration", retryable: false });
  }
  const res = await google(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }).toString() }, timeoutMs);
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw fail({ code: "SHEETS_AUTH_FAILED", message: `Google rejected the service account: ${j.error_description ?? res.status}. The key may have been deleted — create a new one.`, errorClass: "permission", retryable: false });
  tokens.set(key, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

async function google(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw fail({ code: timeout ? "PROVIDER_TIMEOUT" : "NETWORK_ERROR", message: timeout ? `Google didn't respond within ${Math.round(timeoutMs / 1000)}s.` : "Couldn't reach Google.", errorClass: "transient", retryable: true });
  }
}

async function sheetsError(res: Response, sa: ServiceAccount): Promise<never> {
  const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  const detail = j.error?.message ?? `HTTP ${res.status}`;
  if (res.status === 403 || res.status === 404)
    throw fail({ code: `SHEETS_${res.status}`, message: `Google Sheets can't open that spreadsheet. Share it with ${sa.client_email} as an Editor (Share button in Google Sheets), and check the sheet URL. (${detail})`, errorClass: "permission", retryable: false });
  if (res.status === 400) throw fail({ code: "SHEETS_400", message: `Google Sheets rejected the request: ${detail}`, errorClass: "validation", retryable: false });
  if (res.status === 429) throw fail({ code: "SHEETS_RATE_LIMITED", message: "Google Sheets rate limit reached. It will be retried.", errorClass: "transient", retryable: true });
  throw fail({ code: `SHEETS_${res.status}`, message: `Google Sheets returned ${res.status}: ${detail}`, errorClass: res.status >= 500 ? "transient" : "configuration", retryable: res.status >= 500 });
}

const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** Reads the spreadsheet title and tab names (connection test). */
export async function describeSpreadsheet(sa: ServiceAccount, spreadsheetId: string, timeoutMs = 10_000) {
  const token = await accessToken(sa, timeoutMs);
  const res = await google(`${SHEETS}/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
  if (!res.ok) await sheetsError(res, sa);
  const j = (await res.json()) as { properties?: { title?: string }; sheets?: Array<{ properties?: { title?: string } }> };
  return { title: j.properties?.title ?? "Untitled", tabs: (j.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean) };
}

const COLUMN = /^[A-Za-z]{1,3}$/;
const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

/**
 * Appends one row. Mapping fields may be header names from row 1 or column letters (A, B, AA);
 * values are written RAW so text like "=IMPORTXML(...)" from incoming data is never run as a formula.
 */
export async function appendRow(sa: ServiceAccount, spreadsheetId: string, tab: string, cells: Array<{ field: string; value: unknown }>, timeoutMs: number) {
  if (!cells.length) throw fail({ code: "VALIDATION_NO_COLUMNS", message: "Add at least one input mapping row: Field = a column letter (A, B…) or a header from row 1.", errorClass: "validation", retryable: false });
  const token = await accessToken(sa, timeoutMs);
  const auth = { Authorization: `Bearer ${token}` };
  const range = quoteSheet(tab);

  // Header names win over column letters, so a header called "ID" means that column, not column ID.
  const head = await google(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${range}!1:1`)}`, { headers: auth }, timeoutMs);
  if (!head.ok) await sheetsError(head, sa);
  const header = (((await head.json()) as { values?: string[][] }).values?.[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const positions = cells.map((c) => {
    const f = c.field.trim();
    const byHeader = header.indexOf(f.toLowerCase());
    const i = byHeader >= 0 ? byHeader : COLUMN.test(f) ? colIndex(f) : -1;
    if (i < 0) throw fail({ code: "SHEETS_UNKNOWN_COLUMN", message: `No column named “${c.field}” in row 1 of “${tab}”. Use a header from row 1 or a column letter (A, B, …).`, errorClass: "validation", retryable: false });
    return i;
  });
  const row: string[] = Array.from({ length: Math.max(...positions) + 1 }, () => "");
  cells.forEach((c, k) => {
    const v = c.value;
    row[positions[k]!] = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });

  const res = await google(`${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${range}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
  }, timeoutMs);
  if (!res.ok) await sheetsError(res, sa);
  const j = (await res.json()) as { updates?: { updatedRange?: string; updatedRows?: number } };
  return { updatedRange: j.updates?.updatedRange ?? null, rows: j.updates?.updatedRows ?? 1 };
}
