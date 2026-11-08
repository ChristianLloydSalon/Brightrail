import "server-only";
import { lookup } from "node:dns/promises";
import { evalFormula } from "@/lib/engine/formula";
import { appendRow, describeSpreadsheet, parseServiceAccount, spreadsheetIdFrom } from "../google-sheets";
import { airtableCreate, airtableTest, notionCreate, notionTest, teamsSend, teamsUrlProblem, telegramSend, telegramTest } from "../connectors";
import { REDACTED, redact } from "@/lib/domain/redaction";
import type { JsonValue, NodeOf, WorkflowNode } from "@/lib/domain/types";
import { checkOutboundUrl, isPrivateAddress } from "@/lib/domain/url-safety";
import { applyTransform, classifyHttpStatus, evalCondition, fillJsonTemplate, fillTemplate, idempotencyKey, resolveValue, type StepFailure } from "@/lib/engine/logic";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { getPath, setPath } from "@/lib/utils";
import { connectionSecretContext, decryptSecret } from "../crypto";
import { pinnedRequest, type PinnedResponse } from "./http-transport";
import { adminClient } from "../supabase";

/**
 * Activity implementations (spec §06 "Activity workers"). Each call performs at most one external
 * side effect and returns a JSON-safe, redacted result. Secrets are decrypted inside the call and
 * never returned, so they never reach Inngest's step history or the database.
 */

export type ExecResult =
  | { ok: true; input: JsonValue; output: JsonValue; branch?: "true" | "false"; data: Record<string, unknown> }
  | { ok: false; input: JsonValue; failure: StepFailure };

const MAX_BODY = 64 * 1024;

/**
 * Loads a connection only if it belongs to the run's workspace AND is of the integration the step expects,
 * so an HTTP step can't borrow (and leak) a Slack/Resend/Notion/… credential, and vice versa.
 */
async function loadConnection(id: string | undefined, workspaceId: string, integrationId: string) {
  if (!id) return null;
  const db = adminClient();
  const { data: conn } = await db.from("connections").select("*").eq("id", id).eq("workspace_id", workspaceId).eq("integration_id", integrationId).maybeSingle();
  if (!conn) return null;
  const { data: sec } = await db.from("connection_secrets").select("ciphertext").eq("connection_id", id).maybeSingle();
  return { conn, secret: sec ? decryptSecret(sec.ciphertext, connectionSecretContext(id)) : "" };
}

/** Resolves the hostname and refuses private/loopback/metadata addresses (DNS rebinding defence). */
export async function assertPublicHost(url: string) {
  const check = checkOutboundUrl(url);
  if (!check.ok) throw Object.assign(new Error(check.reason), { failure: { code: "SSRF_BLOCKED", message: check.reason, errorClass: "configuration", retryable: false } satisfies StepFailure });
  const host = new URL(url).hostname;
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw Object.assign(new Error("DNS"), { failure: { code: "DNS_LOOKUP_FAILED", message: `Couldn't resolve ${host}.`, errorClass: "transient", retryable: true } satisfies StepFailure });
  if (addrs.some((a) => isPrivateAddress(a.address)))
    throw Object.assign(new Error("SSRF"), { failure: { code: "SSRF_BLOCKED", message: `${host} resolves to a private address. Only public hosts are allowed.`, errorClass: "configuration", retryable: false } satisfies StepFailure });
  return addrs[0]!;
}

async function send(url: string, init: { method: string; headers: Record<string, string>; body?: string; timeoutSec: number }, provider: string) {
  // Connect to the exact address that was just checked, so a second DNS answer can't point elsewhere.
  const pin = await assertPublicHost(url);
  let res: PinnedResponse;
  try {
    res = await pinnedRequest(url, { method: init.method, headers: init.headers, body: init.body }, pin, init.timeoutSec * 1000, MAX_BODY);
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw Object.assign(new Error("fetch"), {
      failure: timeout
        ? { code: "PROVIDER_TIMEOUT", message: `${provider} didn't respond within ${init.timeoutSec}s.`, errorClass: "transient", retryable: true }
        : { code: "NETWORK_ERROR", message: `Couldn't reach ${provider}: ${(e as Error).message}`, errorClass: "transient", retryable: true },
    });
  }
  if (res.status >= 300 && res.status < 400)
    throw Object.assign(new Error("redirect"), { failure: { code: `HTTP_${res.status}_REDIRECT`, message: `${provider} returned a redirect. Redirects aren't followed; use the final URL.`, errorClass: "configuration", retryable: false } });
  const text = res.text;
  let body: JsonValue = text;
  try {
    body = text ? (JSON.parse(text) as JsonValue) : null;
  } catch {
    /* keep text */
  }
  if (res.status < 200 || res.status >= 300) throw Object.assign(new Error("status"), { failure: classifyHttpStatus(res.status, provider), body });
  return { status: res.status, body };
}

function mapInputs(mapping: Array<{ field: string; source: string }>, data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const m of mapping) if (m.field) out[m.field] = resolveValue(m.source, data);
  return out;
}

/** The run a step belongs to. `scope` identifies a loop iteration, so retries and idempotency keys stay per item. */
export type RunRef = { id: string; workspaceId: string; scope?: string };

export async function executeNode(node: WorkflowNode, data: Record<string, unknown>, run: RunRef): Promise<ExecResult> {
  const working = structuredClone(data);
  let input: JsonValue = null;
  try {
    switch (node.kind) {
      case "trigger": {
        input = redact(working.trigger as JsonValue);
        const missing = node.config.requiredFields.filter((f) => getPath(working.trigger, f) === undefined || getPath(working.trigger, f) === "");
        if (missing.length)
          return { ok: false, input, failure: { code: "VALIDATION_MISSING_FIELD", message: `The trigger payload is missing: ${missing.join(", ")}.`, errorClass: "validation", retryable: false } };
        return { ok: true, input, output: input, data: working };
      }
      case "transform": {
        input = redact(working as JsonValue);
        const out = applyTransform(node.config, working);
        return { ok: true, input: redact(Object.fromEntries(node.config.mappings.map((m) => [m.source, (getPath(working, m.source) ?? null) as JsonValue]))), output: redact(out as JsonValue), data: working };
      }
      case "condition": {
        const result = evalCondition(node.config, working);
        return { ok: true, input: redact({ field: node.config.field, actual: (getPath(working, node.config.field) ?? null) as JsonValue }), output: { result, branch: result ? "true" : "false" }, branch: result ? "true" : "false", data: working };
      }
      case "delay":
        return { ok: true, input: { amount: node.config.amount, unit: node.config.unit }, output: { resumedAt: new Date().toISOString() }, data: working };
      case "errorHandler":
        return { ok: true, input: null, output: { strategy: node.config.strategy }, data: working };
      case "loop": {
        const list = getPath(working, node.config.field);
        input = { field: node.config.field };
        if (!Array.isArray(list))
          return { ok: false, input, failure: { code: "LOOP_NOT_A_LIST", message: `“${node.config.field}” isn't a list${list === undefined ? " (the field doesn't exist)" : ""}. Point For each at a list such as items or order.lines.`, errorClass: "validation", retryable: false } };
        const count = Math.min(list.length, node.config.maxItems);
        return { ok: true, input, output: { items: list.length, processed: count, skipped: list.length - count }, data: working };
      }
      case "formula": {
        const out: Record<string, unknown> = {};
        input = redact(Object.fromEntries(node.config.assignments.filter((a) => a.target).map((a) => [a.target, a.expression])) as JsonValue);
        for (const a of node.config.assignments) {
          if (!a.target.trim()) continue;
          try {
            const v = evalFormula(a.expression, working);
            setPath(working, a.target, v);
            out[a.target] = v;
          } catch (e) {
            return { ok: false, input, failure: { code: "FORMULA_ERROR", message: `${a.target}: ${(e as Error).message}`, errorClass: "validation", retryable: false } };
          }
        }
        return { ok: true, input, output: redact(out as JsonValue), data: working };
      }
      case "http":
        return await execHttp(node, working, run);
      case "action":
        return await execAction(node, working, run);
    }
  } catch (e) {
    const failure = (e as { failure?: StepFailure }).failure ?? { code: "INTERNAL_ERROR", message: (e as Error).message, errorClass: "unknown", retryable: false };
    return { ok: false, input, failure };
  }
}

/**
 * True when `url` is on the same origin as `base` and its path is the base path or below it (segment-bounded).
 * A plain string prefix would let "https://api.example.com.attacker.example/" match "https://api.example.com".
 */
export function withinBase(url: string, base: string): boolean {
  try {
    const u = new URL(url);
    const b = new URL(base);
    if (u.origin !== b.origin) return false;
    const prefix = b.pathname.endsWith("/") ? b.pathname : `${b.pathname}/`;
    return u.pathname === b.pathname || u.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

const AUTH_HEADERS = new Set(["authorization", "x-api-key"]);

async function execHttp(node: NodeOf<"http">, data: Record<string, unknown>, run: RunRef): Promise<ExecResult> {
  const c = node.config;
  // Run data is percent-encoded into the URL so it can't add path segments, a query or a fragment.
  const url = fillTemplate(c.url, data, encodeURIComponent);
  const headers: Record<string, string> = Object.fromEntries(c.headers.filter((h) => h.key).map((h) => [h.key, fillTemplate(h.value, data)]));
  const badHeader = Object.entries(headers).find(([, v]) => /[\u0000-\u0008\u000a-\u001f\u007f]/.test(v));
  if (badHeader) return { ok: false, input: { method: c.method, url }, failure: { code: "VALIDATION_HEADER", message: `Header “${badHeader[0]}” would contain a line break or control character from run data.`, errorClass: "validation", retryable: false } };
  const key = idempotencyKey(run.id, run.scope ? `${node.id}@${run.scope}` : node.id);
  if (c.useIdempotencyKey) headers["Idempotency-Key"] = key;
  const loaded = await loadConnection(c.connectionId, run.workspaceId, "int_http");
  if (c.connectionId && !loaded)
    return { ok: false, input: { method: c.method, url }, failure: { code: "CONNECTION_NOT_FOUND", message: "The selected connection no longer exists or isn't an HTTP Request connection.", errorClass: "configuration", retryable: false } };
  let authHeader: string | null = null;
  if (loaded) {
    if (loaded.conn.status === "revoked") return { ok: false, input: { method: c.method, url }, failure: { code: "CONNECTION_REVOKED", message: `Connection “${loaded.conn.display_name}” was revoked.`, errorClass: "permission", retryable: false } };
    const base = String(loaded.conn.config?.baseUrl ?? "");
    // An HTTP connection without a base URL would be an unrestricted credential: refuse it.
    if (!base || !withinBase(url, base)) return { ok: false, input: { method: c.method, url }, failure: { code: "URL_OUTSIDE_CONNECTION", message: base ? `This connection only allows URLs under ${base}.` : "This connection has no base URL. Edit it and set one.", errorClass: "configuration", retryable: false } };
    const configured = String(loaded.conn.config?.authHeader ?? "Authorization");
    authHeader = AUTH_HEADERS.has(configured.toLowerCase()) ? configured : "Authorization";
    headers[authHeader] = authHeader.toLowerCase() === "authorization" ? `Bearer ${loaded.secret}` : loaded.secret;
  }
  let body: string | undefined;
  if (c.method !== "GET" && c.method !== "DELETE" && c.body?.trim()) {
    body = fillJsonTemplate(c.body, data);
    headers["Content-Type"] ??= "application/json";
  }
  // The injected credential is always masked in the recorded step input, whatever the header is called.
  const shownHeaders = authHeader ? { ...headers, [authHeader]: REDACTED } : headers;
  const input = redact({ method: c.method, url, headers: shownHeaders, body: body ?? null } as JsonValue);
  const res = await send(url, { method: c.method, headers, body, timeoutSec: c.timeoutSec }, new URL(url).hostname);
  data.status = res.status;
  data.body = res.body;
  setPath(data, `steps.${node.id}`, res);
  return { ok: true, input, output: redact(res as unknown as JsonValue), data };
}

async function execAction(node: NodeOf<"action">, data: Record<string, unknown>, run: RunRef): Promise<ExecResult> {
  const c = node.config;
  const integ = INTEGRATIONS.find((i) => i.id === c.integrationId);
  const action = integ?.actions.find((a) => a.key === c.actionKey);
  const mapped = mapInputs(c.inputMapping, data);
  const input = redact(mapped as JsonValue, action?.sensitiveFields ?? []);
  if (!integ || !action) return { ok: false, input, failure: { code: "ACTION_NOT_FOUND", message: "The selected integration action doesn't exist.", errorClass: "configuration", retryable: false } };
  const loaded = await loadConnection(c.connectionId, run.workspaceId, integ.id);
  if (!loaded) return { ok: false, input, failure: { code: "CONNECTION_NOT_FOUND", message: `Choose a ${integ.name} connection for this step.`, errorClass: "configuration", retryable: false } };
  if (loaded.conn.status === "revoked") return { ok: false, input, failure: { code: "CONNECTION_REVOKED", message: `Connection “${loaded.conn.display_name}” was revoked.`, errorClass: "permission", retryable: false } };
  const key = idempotencyKey(run.id, run.scope ? `${node.id}@${run.scope}` : node.id);
  const text = String(mapped.text ?? mapped.message ?? "").slice(0, 3900);

  let output: Record<string, unknown>;
  switch (c.actionKey) {
    case "slack.post_message": {
      if (!loaded.secret.startsWith("https://hooks.slack.com/")) return { ok: false, input, failure: { code: "INVALID_WEBHOOK_URL", message: "The Slack webhook URL must start with https://hooks.slack.com/.", errorClass: "configuration", retryable: false } };
      if (!text) return { ok: false, input, failure: { code: "VALIDATION_EMPTY_MESSAGE", message: "Map a “text” input for the message.", errorClass: "validation", retryable: false } };
      await send(loaded.secret, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), timeoutSec: c.timeoutSec }, "Slack");
      output = { ok: true, channel: loaded.conn.config?.channel ?? null };
      break;
    }
    case "discord.post_message": {
      if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(loaded.secret)) return { ok: false, input, failure: { code: "INVALID_WEBHOOK_URL", message: "The Discord webhook URL must start with https://discord.com/api/webhooks/.", errorClass: "configuration", retryable: false } };
      if (!text) return { ok: false, input, failure: { code: "VALIDATION_EMPTY_MESSAGE", message: "Map a “text” input for the message.", errorClass: "validation", retryable: false } };
      await send(`${loaded.secret}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text.slice(0, 2000) }), timeoutSec: c.timeoutSec }, "Discord");
      output = { ok: true, channel: loaded.conn.config?.channel ?? null };
      break;
    }
    case "email.send": {
      const to = String(mapped.to ?? "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, input, failure: { code: "VALIDATION_INVALID_RECIPIENT", message: "Map “to” to a valid email address.", errorClass: "validation", retryable: false } };
      const res = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${loaded.secret}`, "Idempotency-Key": key },
        body: JSON.stringify({ from: loaded.conn.config?.fromAddress, to: [to], subject: String(mapped.subject ?? "(no subject)"), text: String(mapped.text ?? "") }),
        timeoutSec: c.timeoutSec,
      }, "Resend");
      output = { id: (res.body as { id?: string } | null)?.id ?? null, to };
      break;
    }
    case "telegram.send_message": {
      const r = await telegramSend(loaded.secret, String(loaded.conn.config?.chatId ?? ""), text, c.timeoutSec * 1000);
      output = { messageId: r.messageId, chat: loaded.conn.config?.chatId ?? null };
      break;
    }
    case "teams.post_message": {
      await teamsSend(loaded.secret, String(mapped.title ?? ""), text, c.timeoutSec * 1000);
      output = { ok: true, channel: loaded.conn.config?.channel ?? null };
      break;
    }
    case "notion.create_page": {
      const cells = c.inputMapping.filter((m) => m.field.trim()).map((m) => ({ field: m.field, value: mapped[m.field] }));
      output = await notionCreate(loaded.secret, String(loaded.conn.config?.database ?? ""), cells, c.timeoutSec * 1000);
      break;
    }
    case "airtable.create_record": {
      const cells = c.inputMapping.filter((m) => m.field.trim()).map((m) => ({ field: m.field, value: mapped[m.field] }));
      output = await airtableCreate(loaded.secret, String(loaded.conn.config?.base ?? ""), String(loaded.conn.config?.table ?? ""), cells, c.timeoutSec * 1000);
      break;
    }
    case "sheets.append_row": {
      const sa = parseServiceAccount(loaded.secret);
      if ("error" in sa) return { ok: false, input, failure: { code: "SHEETS_BAD_KEY", message: sa.error, errorClass: "configuration", retryable: false } };
      const sheetId = spreadsheetIdFrom(String(loaded.conn.config?.spreadsheet ?? ""));
      if (!sheetId) return { ok: false, input, failure: { code: "SHEETS_BAD_URL", message: "The connection's spreadsheet URL isn't valid. Edit the connection and paste the sheet's address.", errorClass: "configuration", retryable: false } };
      const tab = String(loaded.conn.config?.sheetName ?? "Sheet1");
      const cells = c.inputMapping.filter((m) => m.field.trim()).map((m) => ({ field: m.field, value: mapped[m.field] }));
      const res = await appendRow(sa, sheetId, tab, cells, c.timeoutSec * 1000);
      output = { updatedRange: res.updatedRange, rows: res.rows };
      break;
    }
    default:
      return { ok: false, input, failure: { code: "ACTION_NOT_SUPPORTED", message: `${action.name} isn't supported yet.`, errorClass: "configuration", retryable: false } };
  }
  const redacted = redact(output as JsonValue, action.sensitiveFields);
  setPath(data, `steps.${node.id}`, output);
  return { ok: true, input, output: redacted, data };
}

/** Connection test: the cheapest authenticated check for each connector. No messages are sent. */
export async function testConnectionConfig(integrationId: string, config: Record<string, string>, secret: string): Promise<{ ok: boolean; message: string }> {
  try {
    switch (integrationId) {
      case "int_http": {
        const base = config.baseUrl ?? "";
        await assertPublicHost(base);
        return { ok: true, message: `${new URL(base).hostname} is a reachable public host. The token will be sent as ${config.authHeader === "X-API-Key" ? "an X-API-Key header" : "a Bearer token"}.` };
      }
      case "int_slack":
        if (!secret.startsWith("https://hooks.slack.com/services/")) return { ok: false, message: "That isn't a Slack incoming-webhook URL. It should start with https://hooks.slack.com/services/." };
        return { ok: true, message: "Webhook URL looks valid. Slack only confirms it when the first message is posted." };
      case "int_discord": {
        if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(secret)) return { ok: false, message: "That isn't a Discord webhook URL. It should look like https://discord.com/api/webhooks/123/abc." };
        const res = await fetch(secret, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
        return res.ok ? { ok: true, message: "Discord confirmed the webhook exists." } : { ok: false, message: `Discord returned ${res.status}. The webhook may have been deleted.` };
      }
      case "int_resend": {
        const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000) });
        if (res.status === 401 || res.status === 403) {
          // Sending-only keys can't list domains but are still valid for sending.
          const body = await res.text();
          if (/restricted/i.test(body)) return { ok: true, message: "Resend accepted the key (sending-only access)." };
          return { ok: false, message: "Resend rejected this API key." };
        }
        return res.ok ? { ok: true, message: "Resend accepted the API key." } : { ok: false, message: `Resend returned ${res.status}.` };
      }
      case "int_telegram":
        return await telegramTest(secret, config.chatId ?? "");
      case "int_teams": {
        const problem = teamsUrlProblem(secret);
        return problem ? { ok: false, message: problem } : { ok: true, message: "Webhook URL looks right. Teams only confirms it when the first message is posted." };
      }
      case "int_notion":
        return await notionTest(secret, config.database ?? "");
      case "int_airtable":
        return await airtableTest(secret, config.base ?? "", config.table ?? "");
      case "int_sheets": {
        const sa = parseServiceAccount(secret);
        if ("error" in sa) return { ok: false, message: sa.error };
        const sheetId = spreadsheetIdFrom(config.spreadsheet ?? "");
        if (!sheetId) return { ok: false, message: "That doesn't look like a Google Sheets URL. Copy it from the address bar while the sheet is open." };
        const info = await describeSpreadsheet(sa, sheetId);
        const tab = (config.sheetName ?? "").trim();
        if (tab && !info.tabs.includes(tab)) return { ok: false, message: `Opened “${info.title}”, but it has no tab named “${tab}”. Tabs: ${info.tabs.join(", ")}.` };
        return { ok: true, message: `Connected to “${info.title}” → “${tab || info.tabs[0]}”.` };
      }
      default:
        return { ok: false, message: "This integration can't be tested." };
    }
  } catch (e) {
    const f = (e as { failure?: StepFailure }).failure;
    return { ok: false, message: f?.message ?? (e as Error).message };
  }
}
