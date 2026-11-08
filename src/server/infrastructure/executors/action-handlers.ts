import "server-only";
import { parseServiceAccount, spreadsheetIdFrom } from "@/lib/integrations/google-sheets-format";
import type { Connection, NodeOf } from "@/lib/domain/types";
import type { StepFailure } from "@/lib/engine/logic";
import { airtableCreate, notionCreate, teamsSend, telegramSend } from "../connectors/connectors";
import { appendRow } from "../connectors/google-sheets";
import { send } from "./outbound";

/** Everything an integration action needs: resolved inputs, the bound connection and its decrypted secret. */
export interface ActionContext {
  config: NodeOf<"action">["config"];
  mapped: Record<string, unknown>;
  connection: Connection;
  secret: string;
  idempotencyKey: string;
  /** `text`/`message` input, capped for chat providers. */
  text: string;
  timeoutMs: number;
}

/** Output to record, or a failure the step reports without retrying. */
export type ActionOutcome = { output: Record<string, unknown> } | { failure: StepFailure };

/** Strategy for one integration action key. */
export interface ActionHandler {
  run(ctx: ActionContext): Promise<ActionOutcome>;
}

const reject = (code: string, message: string, errorClass: StepFailure["errorClass"]): ActionOutcome => ({ failure: { code, message, errorClass, retryable: false } });
const EMPTY_MESSAGE = reject("VALIDATION_EMPTY_MESSAGE", "Map a “text” input for the message.", "validation");
const cellsOf = (c: ActionContext) => c.config.inputMapping.filter((m) => m.field.trim()).map((m) => ({ field: m.field, value: c.mapped[m.field] }));
const channelOf = (c: ActionContext) => c.connection.config?.channel ?? null;

const slack: ActionHandler = {
  async run(c) {
    if (!c.secret.startsWith("https://hooks.slack.com/")) return reject("INVALID_WEBHOOK_URL", "The Slack webhook URL must start with https://hooks.slack.com/.", "configuration");
    if (!c.text) return EMPTY_MESSAGE;
    await send(c.secret, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: c.text }), timeoutSec: c.config.timeoutSec }, "Slack");
    return { output: { ok: true, channel: channelOf(c) } };
  },
};

const discord: ActionHandler = {
  async run(c) {
    if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(c.secret)) return reject("INVALID_WEBHOOK_URL", "The Discord webhook URL must start with https://discord.com/api/webhooks/.", "configuration");
    if (!c.text) return EMPTY_MESSAGE;
    await send(`${c.secret}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: c.text.slice(0, 2000) }), timeoutSec: c.config.timeoutSec }, "Discord");
    return { output: { ok: true, channel: channelOf(c) } };
  },
};

const email: ActionHandler = {
  async run(c) {
    const to = String(c.mapped.to ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return reject("VALIDATION_INVALID_RECIPIENT", "Map “to” to a valid email address.", "validation");
    const res = await send("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.secret}`, "Idempotency-Key": c.idempotencyKey },
      body: JSON.stringify({ from: c.connection.config?.fromAddress, to: [to], subject: String(c.mapped.subject ?? "(no subject)"), text: String(c.mapped.text ?? "") }),
      timeoutSec: c.config.timeoutSec,
    }, "Resend");
    return { output: { id: (res.body as { id?: string } | null)?.id ?? null, to } };
  },
};

const telegram: ActionHandler = {
  async run(c) {
    const r = await telegramSend(c.secret, String(c.connection.config?.chatId ?? ""), c.text, c.timeoutMs);
    return { output: { messageId: r.messageId, chat: c.connection.config?.chatId ?? null } };
  },
};

const teams: ActionHandler = {
  async run(c) {
    await teamsSend(c.secret, String(c.mapped.title ?? ""), c.text, c.timeoutMs);
    return { output: { ok: true, channel: channelOf(c) } };
  },
};

const notion: ActionHandler = {
  async run(c) {
    return { output: await notionCreate(c.secret, String(c.connection.config?.database ?? ""), cellsOf(c), c.timeoutMs) };
  },
};

const airtable: ActionHandler = {
  async run(c) {
    return { output: await airtableCreate(c.secret, String(c.connection.config?.base ?? ""), String(c.connection.config?.table ?? ""), cellsOf(c), c.timeoutMs) };
  },
};

const sheets: ActionHandler = {
  async run(c) {
    const sa = parseServiceAccount(c.secret);
    if ("error" in sa) return reject("SHEETS_BAD_KEY", sa.error, "configuration");
    const sheetId = spreadsheetIdFrom(String(c.connection.config?.spreadsheet ?? ""));
    if (!sheetId) return reject("SHEETS_BAD_URL", "The connection's spreadsheet URL isn't valid. Edit the connection and paste the sheet's address.", "configuration");
    const res = await appendRow(sa, sheetId, String(c.connection.config?.sheetName ?? "Sheet1"), cellsOf(c), c.timeoutMs);
    return { output: { updatedRange: res.updatedRange, rows: res.rows } };
  },
};

/** Registry: action key → handler. Adding a connector action means adding one entry here. */
export const ACTION_HANDLERS: Readonly<Record<string, ActionHandler>> = {
  "slack.post_message": slack,
  "discord.post_message": discord,
  "email.send": email,
  "telegram.send_message": telegram,
  "teams.post_message": teams,
  "notion.create_page": notion,
  "airtable.create_record": airtable,
  "sheets.append_row": sheets,
};
