import type { Integration } from "@/lib/domain/types";

/**
 * Built-in connectors (spec §03: a small set of built-in connectors plus generic HTTP).
 * Every available connector talks to a real service with a free tier.
 */
export const INTEGRATIONS: Integration[] = [
  {
    id: "int_http",
    name: "HTTP Request",
    vendor: "Any public HTTPS API",
    category: "Core",
    summary: "Call any public HTTPS API, optionally with a stored token.",
    description:
      "Sends requests to public HTTPS endpoints. Private, loopback and cloud-metadata addresses are blocked (including after DNS resolution), redirects are not followed, and the token is added by the worker at run time so it never appears in the workflow.",
    availability: "available",
    authType: "bearer",
    configFields: [
      { key: "baseUrl", label: "Base URL", type: "url", required: true, placeholder: "https://api.example.com", help: "HTTP steps using this connection must call URLs that start with this." },
      { key: "authHeader", label: "Auth header", type: "select", required: true, options: ["Authorization", "X-API-Key"], help: "Authorization sends “Bearer <token>”; X-API-Key sends the token as-is." },
      { key: "token", label: "Token or API key", type: "secret", required: true, placeholder: "Paste the token", help: "Encrypted before it's stored. You won't be able to see it again." },
    ],
    actions: [
      { key: "http.request", name: "Send request", description: "Send an HTTPS request and return status and body.", idempotent: false, retryable: true, timeoutSec: 30, scopes: ["outbound:https"], sensitiveFields: ["authorization"], outputFields: ["status", "body"] },
    ],
    docs: [
      "Retries apply to timeouts, 429 and 5xx responses. Other 4xx responses are not retried.",
      "With “Send idempotency key” on, each step sends an Idempotency-Key header that stays the same across retries.",
    ],
  },
  {
    id: "int_webhook",
    name: "Signed Webhooks",
    vendor: "Brightrail",
    category: "Core",
    summary: "Start workflows when another system sends an event.",
    description:
      "Each endpoint verifies an HMAC-SHA256 signature over the timestamp and raw body, rejects old timestamps, and records the event ID so duplicate deliveries don't start duplicate runs.",
    availability: "available",
    authType: "signing_secret",
    configFields: [],
    actions: [],
    docs: [
      "Headers: X-Brightrail-Timestamp (unix seconds), X-Brightrail-Signature (sha256=<hex>), optional X-Brightrail-Event-Id.",
      "Signature = HMAC_SHA256(signing_secret, timestamp + \".\" + raw_body).",
    ],
  },
  {
    id: "int_slack",
    name: "Slack",
    vendor: "Slack incoming webhooks (free)",
    category: "Communication",
    summary: "Post messages to a Slack channel.",
    description: "Uses a Slack incoming-webhook URL for one channel. Create one in your Slack workspace under Apps → Incoming Webhooks. The URL is treated as a secret.",
    availability: "available",
    authType: "api_key",
    configFields: [
      { key: "channel", label: "Channel name", type: "text", required: true, placeholder: "#ops-alerts", help: "For your reference. The webhook URL decides the channel." },
      { key: "webhookUrl", label: "Incoming webhook URL", type: "secret", required: true, placeholder: "https://hooks.slack.com/services/…", help: "Must start with https://hooks.slack.com/." },
    ],
    actions: [
      { key: "slack.post_message", name: "Post message", description: "Post a text message. Use {{field}} to insert run data.", idempotent: false, retryable: true, timeoutSec: 10, scopes: ["incoming-webhook"], sensitiveFields: [], outputFields: ["ok"] },
    ],
    docs: ["Not idempotent: a retry after a lost response can post twice. Keep max attempts low."],
  },
  {
    id: "int_discord",
    name: "Discord",
    vendor: "Discord webhooks (free)",
    category: "Communication",
    summary: "Post messages to a Discord channel.",
    description: "Uses a Discord channel webhook. Create one in Server Settings → Integrations → Webhooks. The URL is treated as a secret.",
    availability: "available",
    authType: "api_key",
    configFields: [
      { key: "channel", label: "Channel name", type: "text", required: true, placeholder: "#alerts" },
      { key: "webhookUrl", label: "Webhook URL", type: "secret", required: true, placeholder: "https://discord.com/api/webhooks/…", help: "Must start with https://discord.com/api/webhooks/." },
    ],
    actions: [
      { key: "discord.post_message", name: "Post message", description: "Post a text message (max 2,000 characters).", idempotent: false, retryable: true, timeoutSec: 10, scopes: ["webhook"], sensitiveFields: [], outputFields: ["ok"] },
    ],
    docs: ["Discord rate-limits webhooks; 429 responses are retried with backoff."],
  },
  {
    id: "int_resend",
    name: "Resend email",
    vendor: "Resend (free tier)",
    category: "Communication",
    summary: "Send transactional email.",
    description: "Sends email through Resend's API. The free tier covers testing and small volumes. Use a sender address on a domain you've verified in Resend (or onboarding@resend.dev while testing).",
    availability: "available",
    authType: "api_key",
    configFields: [
      { key: "fromAddress", label: "From address", type: "text", required: true, placeholder: "Brightrail <onboarding@resend.dev>" },
      { key: "apiKey", label: "Resend API key", type: "secret", required: true, placeholder: "re_…" },
    ],
    actions: [
      { key: "email.send", name: "Send email", description: "Send a plain-text email. Map “to”, “subject” and “text”.", idempotent: true, retryable: true, timeoutSec: 15, scopes: ["emails:send"], sensitiveFields: ["to"], outputFields: ["id"] },
    ],
    docs: ["Each send includes an Idempotency-Key, so a retry never sends the same email twice.", "External communication: AI-proposed retries always need approval."],
  },
  {
    id: "int_telegram",
    name: "Telegram",
    vendor: "Telegram",
    category: "Communication",
    summary: "Send messages to a chat, group or channel with a bot.",
    description: "Post a message through your own Telegram bot. Free; create the bot in a minute with @BotFather.",
    availability: "available",
    authType: "api_key",
    configFields: [
      { key: "chatId", label: "Chat ID", type: "text", required: true, placeholder: "-1001234567890 or @mychannel", help: "Group/chat ID, or @username for a public channel. See SETUP.md for how to find it." },
      { key: "botToken", label: "Bot token", type: "secret", required: true, placeholder: "123456789:AA…", help: "From @BotFather in Telegram (/newbot)." },
    ],
    actions: [
      { key: "telegram.send_message", name: "Send message", description: "Send a text message. Map “text”.", idempotent: false, retryable: true, timeoutSec: 10, scopes: ["bot"], sensitiveFields: [], outputFields: ["messageId"] },
    ],
    docs: ["Add the bot to the group (or as an admin of the channel) before testing.", "Messages are sent as plain text, up to 4,000 characters."],
  },
  {
    id: "int_teams",
    name: "Microsoft Teams",
    vendor: "Microsoft",
    category: "Communication",
    summary: "Post messages to a Teams channel.",
    description: "Post a card to a Teams channel through a Teams Workflows webhook (the replacement for the retired Office 365 connectors).",
    availability: "available",
    authType: "api_key",
    configFields: [
      { key: "channel", label: "Channel name", type: "text", required: true, placeholder: "Ops alerts", help: "Only used as a label in Brightrail." },
      { key: "webhookUrl", label: "Workflow webhook URL", type: "secret", required: true, placeholder: "https://…logic.azure.com/workflows/…", help: "Teams → channel ••• → Workflows → “Post to a channel when a webhook request is received” → copy the URL." },
    ],
    actions: [
      { key: "teams.post_message", name: "Post message", description: "Post a card. Map “text”, and optionally “title”.", idempotent: false, retryable: true, timeoutSec: 15, scopes: ["webhook"], sensitiveFields: [], outputFields: ["ok"] },
    ],
    docs: ["Teams can't confirm the URL without posting, so the connection test only checks its format.", "Old “Incoming Webhook” connector URLs (…webhook.office.com) stopped working when Microsoft retired them."],
  },
  {
    id: "int_notion",
    name: "Notion",
    vendor: "Notion",
    category: "Data",
    summary: "Add rows (pages) to a Notion database.",
    description: "Create a page in a Notion database, filling its columns from your workflow — e.g. log leads, tasks or feedback.",
    availability: "available",
    authType: "bearer",
    configFields: [
      { key: "database", label: "Database link", type: "text", required: true, placeholder: "https://www.notion.so/…?v=…", help: "Open the database as a full page → Share → Copy link." },
      { key: "token", label: "Integration secret", type: "secret", required: true, placeholder: "ntn_…", help: "notion.so/profile/integrations → New integration → Internal → copy the secret." },
    ],
    actions: [
      { key: "notion.create_page", name: "Add row", description: "Add a row. In the input mapping, Field is a column name and the value is what goes in it.", idempotent: false, retryable: true, timeoutSec: 20, scopes: ["insert_content"], sensitiveFields: [], outputFields: ["pageId", "url"] },
    ],
    docs: ["In Notion, open the database → ••• → Connections → add your integration, or the test will say it can't find it.", "Supported columns: title, text, number, select, multi-select, status, checkbox, date, URL, email, phone."],
  },
  {
    id: "int_airtable",
    name: "Airtable",
    vendor: "Airtable",
    category: "Data",
    summary: "Create records in an Airtable base.",
    description: "Add a record to an Airtable table, with Airtable converting text to numbers, dates and select options as needed.",
    availability: "available",
    authType: "bearer",
    configFields: [
      { key: "base", label: "Base link or ID", type: "text", required: true, placeholder: "https://airtable.com/app…/tbl…", help: "Open the table in Airtable and copy the address bar." },
      { key: "table", label: "Table name", type: "text", required: false, placeholder: "Leads", help: "Optional if the link already includes the table (tbl…)." },
      { key: "token", label: "Personal access token", type: "secret", required: true, placeholder: "pat…", help: "airtable.com/create/tokens — scopes data.records:read and data.records:write, with access to this base." },
    ],
    actions: [
      { key: "airtable.create_record", name: "Create record", description: "Add one record. In the input mapping, Field is an Airtable field name.", idempotent: false, retryable: true, timeoutSec: 15, scopes: ["data.records:write"], sensitiveFields: [], outputFields: ["recordId"] },
    ],
    docs: ["Field names must match the table exactly (case-sensitive).", "The free plan allows 5 requests per second per base; Brightrail retries if it's rate-limited."],
  },
  {
    id: "int_schedule",
    name: "Schedule trigger",
    vendor: "Brightrail",
    category: "Core",
    summary: "Start workflows on a schedule.",
    description: "Run a workflow every few minutes or hours, daily, on chosen weekdays, monthly, or on any cron expression — in the time zone you pick. Choose “On a schedule” in a workflow's trigger step, then publish.",
    availability: "available",
    authType: "none",
    configFields: [],
    actions: [],
    docs: [
      "Runs at least 5 minutes apart. Daylight-saving changes are handled for the chosen time zone.",
      "Each run starts with { scheduledFor } as input. Pausing or archiving the workflow stops the schedule; resuming restarts it.",
      "If the worker was offline at a scheduled time, that slot is skipped (no burst of catch-up runs).",
    ],
  },
  {
    id: "int_sheets",
    name: "Google Sheets",
    vendor: "Google",
    category: "Data",
    summary: "Append rows to a spreadsheet.",
    description: "Add a row to a Google Sheet from any workflow — for example log every form submission or order. Connects with a Google service account, so there's no Google sign-in screen to set up.",
    availability: "available",
    authType: "api_key",
    configFields: [
      { key: "spreadsheet", label: "Spreadsheet URL", type: "text", required: true, placeholder: "https://docs.google.com/spreadsheets/d/…/edit", help: "Open the sheet in Google Sheets and copy the address bar." },
      { key: "sheetName", label: "Tab name", type: "text", required: true, placeholder: "Sheet1", help: "The tab at the bottom of the sheet that rows are added to." },
      { key: "serviceAccountKey", label: "Service account key (JSON)", type: "secret", required: true, placeholder: "{ \"type\": \"service_account\", … }", help: "Paste the whole JSON key file. Then share the spreadsheet with the service account's email as an Editor." },
    ],
    actions: [
      { key: "sheets.append_row", name: "Append row", description: "Add one row. In the input mapping, Field is a header from row 1 (or a column letter) and the value is what goes in that cell.", idempotent: false, retryable: true, timeoutSec: 15, scopes: ["spreadsheets"], sensitiveFields: [], outputFields: ["updatedRange"] },
    ],
    docs: [
      "Setup (about 5 minutes): Google Cloud console → create a project → enable the Google Sheets API → IAM & Admin → Service accounts → create one → Keys → Add key → JSON. Paste that file here.",
      "Share your spreadsheet with the service account's email (ends in .iam.gserviceaccount.com) as an Editor — just like sharing with a person.",
      "Values are written exactly as text/numbers; anything that looks like a formula is not executed.",
      "Appending isn't idempotent: a retry after a timeout can add the row twice, so AI-proposed retries always need approval.",
    ],
  },
];

export const INTEGRATION_CATEGORIES = ["Core", "Communication", "Data"] as const;
