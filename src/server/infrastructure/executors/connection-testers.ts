import "server-only";
import { parseServiceAccount, spreadsheetIdFrom } from "@/lib/integrations/google-sheets-format";
import type { StepFailure } from "@/lib/engine/logic";
import type { ConnectionTester } from "@/server/application/ports/services";
import { airtableTest, notionTest, teamsUrlProblem, telegramTest } from "../connectors/connectors";
import { describeSpreadsheet } from "../connectors/google-sheets";
import { assertPublicHost } from "./outbound";

type TestResult = { ok: boolean; message: string };
type Probe = (config: Record<string, string>, secret: string) => Promise<TestResult> | TestResult;

/** One cheap, authenticated check per connector. No messages are sent. */
const PROBES: Readonly<Record<string, Probe>> = {
  async int_http(config) {
    const base = config.baseUrl ?? "";
    await assertPublicHost(base);
    return { ok: true, message: `${new URL(base).hostname} is a reachable public host. The token will be sent as ${config.authHeader === "X-API-Key" ? "an X-API-Key header" : "a Bearer token"}.` };
  },
  int_slack(_, secret) {
    if (!secret.startsWith("https://hooks.slack.com/services/")) return { ok: false, message: "That isn't a Slack incoming-webhook URL. It should start with https://hooks.slack.com/services/." };
    return { ok: true, message: "Webhook URL looks valid. Slack only confirms it when the first message is posted." };
  },
  async int_discord(_, secret) {
    if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(secret)) return { ok: false, message: "That isn't a Discord webhook URL. It should look like https://discord.com/api/webhooks/123/abc." };
    const res = await fetch(secret, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    return res.ok ? { ok: true, message: "Discord confirmed the webhook exists." } : { ok: false, message: `Discord returned ${res.status}. The webhook may have been deleted.` };
  },
  async int_resend(_, secret) {
    const res = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) {
      // Sending-only keys can't list domains but are still valid for sending.
      if (/restricted/i.test(await res.text())) return { ok: true, message: "Resend accepted the key (sending-only access)." };
      return { ok: false, message: "Resend rejected this API key." };
    }
    return res.ok ? { ok: true, message: "Resend accepted the API key." } : { ok: false, message: `Resend returned ${res.status}.` };
  },
  int_telegram: (config, secret) => telegramTest(secret, config.chatId ?? ""),
  int_teams(_, secret) {
    const problem = teamsUrlProblem(secret);
    return problem ? { ok: false, message: problem } : { ok: true, message: "Webhook URL looks right. Teams only confirms it when the first message is posted." };
  },
  int_notion: (config, secret) => notionTest(secret, config.database ?? ""),
  int_airtable: (config, secret) => airtableTest(secret, config.base ?? "", config.table ?? ""),
  async int_sheets(config, secret) {
    const sa = parseServiceAccount(secret);
    if ("error" in sa) return { ok: false, message: sa.error };
    const sheetId = spreadsheetIdFrom(config.spreadsheet ?? "");
    if (!sheetId) return { ok: false, message: "That doesn't look like a Google Sheets URL. Copy it from the address bar while the sheet is open." };
    const info = await describeSpreadsheet(sa, sheetId);
    const tab = (config.sheetName ?? "").trim();
    if (tab && !info.tabs.includes(tab)) return { ok: false, message: `Opened “${info.title}”, but it has no tab named “${tab}”. Tabs: ${info.tabs.join(", ")}.` };
    return { ok: true, message: `Connected to “${info.title}” → “${tab || info.tabs[0]}”.` };
  },
};

/** ConnectionTester over the probe registry; any thrown failure becomes a plain message. */
export class RegistryConnectionTester implements ConnectionTester {
  async test(integrationId: string, config: Record<string, string>, secret: string): Promise<TestResult> {
    const probe = PROBES[integrationId];
    if (!probe) return { ok: false, message: "This integration can't be tested." };
    try {
      return await probe(config, secret);
    } catch (e) {
      const f = (e as { failure?: StepFailure }).failure;
      return { ok: false, message: f?.message ?? (e as Error).message };
    }
  }
}
