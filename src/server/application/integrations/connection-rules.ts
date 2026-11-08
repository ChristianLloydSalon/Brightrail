import { secretHint } from "@/lib/domain/redaction";
import type { Connection, Integration } from "@/lib/domain/types";
import { checkOutboundUrl } from "@/lib/domain/url-safety";
import { parseServiceAccount, spreadsheetIdFrom } from "@/lib/integrations/google-sheets-format";

export type IntegrationStatus = "connected" | "error" | "not_connected" | "planned";

/** How an integration shows in the directory, given this workspace's connections and trigger usage. */
export function integrationStatus(i: Integration, conns: Connection[], webhooks: number, schedules: number): IntegrationStatus {
  if (i.availability === "planned") return "planned";
  if (i.id === "int_webhook") return webhooks ? "connected" : "not_connected";
  if (i.id === "int_schedule") return schedules ? "connected" : "not_connected";
  const mine = conns.filter((c) => c.integrationId === i.id && c.status !== "revoked");
  if (!mine.length) return "not_connected";
  return mine.some((c) => c.status === "error") ? "error" : "connected";
}

/** Keeps only the integration's declared, non-secret config keys (plus server-derived ones). */
export function pickConfig(integration: Integration, config: Record<string, string>, derived: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of integration.configFields) if (f.type !== "secret" && typeof config[f.key] === "string") out[f.key] = config[f.key]!.trim();
  return { ...out, ...derived };
}

/** Non-secret facts derived from the credential, shown in the UI (e.g. which account to share a sheet with). */
export function derivedFromSecret(integrationId: string, secret: string): Record<string, string> {
  if (integrationId !== "int_sheets") return {};
  const sa = parseServiceAccount(secret);
  return "error" in sa ? {} : { serviceAccountEmail: sa.client_email };
}

/** The masked hint shown in place of the credential. */
export function hintFor(integrationId: string, secret: string): string {
  if (integrationId === "int_sheets") {
    try {
      const id = String(JSON.parse(secret).private_key_id ?? "");
      if (id) return `key ••••${id.slice(-4)}`;
    } catch { /* fall through */ }
  }
  return secretHint(secret);
}

/** Field errors for a connection's non-secret configuration. */
export function configErrors(integration: Integration, config: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (integration.id === "int_sheets" && config.spreadsheet?.trim() && !spreadsheetIdFrom(config.spreadsheet)) errors.spreadsheet = "Paste the Google Sheets address (it contains /spreadsheets/d/…).";
  for (const f of integration.configFields) {
    if (f.type === "secret") continue;
    if (f.required && !config[f.key]?.trim()) errors[f.key] = `${f.label} is required.`;
    if (f.type === "select" && f.options && config[f.key] && !f.options.includes(config[f.key]!)) errors[f.key] = `Choose one of: ${f.options.join(", ")}.`;
    if (f.type === "url" && config[f.key]) {
      const c = checkOutboundUrl(config[f.key]!);
      if (!c.ok) errors[f.key] = c.reason;
    }
  }
  return errors;
}

/** Server-side bounds for webhook settings (keys match the form's field names). */
export function webhookLimitErrors(input: { replayWindowSec: number; maxBodyKb: number; rateLimitPerMin: number }): Record<string, string> {
  const errors: Record<string, string> = {};
  const int = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!int(input.replayWindowSec, 30, 900)) errors.replayWindowSec = "Use between 30 and 900 seconds.";
  if (!int(input.maxBodyKb, 1, 1024)) errors.maxBodyKb = "Use 1–1024 KB.";
  if (!int(input.rateLimitPerMin, 1, 6000)) errors.rate = "Use 1–6000 per minute.";
  return errors;
}
