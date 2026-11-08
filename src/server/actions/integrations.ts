"use server";

import { ApiError } from "@/lib/api-error";
import { secretHint } from "@/lib/domain/redaction";
import { parseServiceAccount, spreadsheetIdFrom } from "../google-sheets";
import type { Connection, Integration, IntegrationCategory, WebhookDelivery, WebhookEndpoint } from "@/lib/domain/types";
import { checkOutboundUrl } from "@/lib/domain/url-safety";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { act, getContext, must, type RequestContext } from "../context";
import { connectionSecretContext, encryptSecret, randomToken, webhookSecretContext } from "../crypto";
import { testConnectionConfig } from "../engine/executors";
import { env } from "../env";
import { toConnection, toDelivery, toWebhook } from "../rows";
import { ingestWebhook } from "../webhooks";

export interface IntegrationListItem extends Integration {
  connectionCount: number;
  status: "connected" | "error" | "not_connected" | "planned";
}
/** Shown once. `link` is the full webhook URL including the key, for secret-link endpoints. */
export interface OneTimeSecret { value: string; hint: string; link?: string }
export interface WebhookListItem extends WebhookEndpoint { workflowName: string; workflowStatus: string; lastDelivery?: WebhookDelivery; deliveries24h: number; rejected24h: number; url: string }

function statusFor(i: Integration, conns: Connection[], webhooks: number, schedules: number): IntegrationListItem["status"] {
  if (i.availability === "planned") return "planned";
  if (i.id === "int_webhook") return webhooks ? "connected" : "not_connected";
  if (i.id === "int_schedule") return schedules ? "connected" : "not_connected";
  const mine = conns.filter((c) => c.integrationId === i.id && c.status !== "revoked");
  if (!mine.length) return "not_connected";
  return mine.some((c) => c.status === "error") ? "error" : "connected";
}

async function allConnections(ctx: RequestContext) {
  const { data } = await ctx.db.from("connections").select("*").eq("workspace_id", ctx.workspace.id).order("created_at");
  return (data ?? []).map(toConnection);
}

/** Keeps only the integration's declared, non-secret config keys (plus server-derived ones). */
function pickConfig(integration: Integration, config: Record<string, string>, derived: Record<string, string> = {}) {
  const out: Record<string, string> = {};
  for (const f of integration.configFields) if (f.type !== "secret" && typeof config[f.key] === "string") out[f.key] = config[f.key]!.trim();
  return { ...out, ...derived };
}

/** Non-secret facts derived from the credential, shown in the UI (e.g. which account to share a sheet with). */
function derivedFromSecret(integrationId: string, secret: string): Record<string, string> {
  if (integrationId !== "int_sheets") return {};
  const sa = parseServiceAccount(secret);
  return "error" in sa ? {} : { serviceAccountEmail: sa.client_email };
}

function hintFor(integrationId: string, secret: string) {
  if (integrationId === "int_sheets") {
    try {
      const id = String(JSON.parse(secret).private_key_id ?? "");
      if (id) return `key ••••${id.slice(-4)}`;
    } catch { /* fall through */ }
  }
  return secretHint(secret);
}

function validateConfig(integration: Integration, config: Record<string, string>) {
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

export async function list(params: { search?: string; category?: IntegrationCategory | "all" } = {}) {
  return act(async (): Promise<IntegrationListItem[]> => {
    const ctx = await getContext("connections.view");
    const conns = await allConnections(ctx);
    const { count } = await ctx.db.from("webhook_endpoints").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).eq("status", "active");
    const { count: schedules } = await ctx.db.from("workflow_schedules").select("workflow_id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).eq("enabled", true);
    let items = INTEGRATIONS.map((i) => ({
      ...i,
      connectionCount: i.id === "int_webhook" ? (count ?? 0) : i.id === "int_schedule" ? (schedules ?? 0) : conns.filter((c) => c.integrationId === i.id && c.status !== "revoked").length,
      status: statusFor(i, conns, count ?? 0, schedules ?? 0),
    }));
    if (params.category && params.category !== "all") items = items.filter((i) => i.category === params.category);
    const q = params.search?.trim().toLowerCase();
    if (q) items = items.filter((i) => [i.name, i.vendor, i.summary, i.category, ...i.actions.map((a) => a.name)].some((t) => t.toLowerCase().includes(q)));
    return items;
  });
}

export async function get(id: string) {
  return act(async () => {
    const ctx = await getContext("connections.view");
    const i = INTEGRATIONS.find((x) => x.id === id);
    if (!i) throw new ApiError("NOT_FOUND", "Integration not found.");
    const conns = (await allConnections(ctx)).filter((c) => c.integrationId === id);
    const { data: wfs } = await ctx.db.from("workflows").select("id, name, draft").eq("workspace_id", ctx.workspace.id);
    const connections = conns.map((c) => ({
      ...c,
      usedBy: (wfs ?? []).filter((w) => JSON.stringify(w.draft).includes(c.id)).map((w) => ({ id: w.id as string, name: w.name as string })),
    }));
    const { count: schedules } = i.id === "int_schedule" ? await ctx.db.from("workflow_schedules").select("workflow_id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).eq("enabled", true) : { count: 0 };
    return { integration: { ...i, connectionCount: i.id === "int_schedule" ? (schedules ?? 0) : connections.length, status: statusFor(i, conns, 0, schedules ?? 0) } as IntegrationListItem, connections };
  });
}

export async function connections() {
  return act(async () => allConnections(await getContext("connections.view")));
}

export async function getConnection(id: string) {
  return act(async () => {
    const ctx = await getContext("connections.view");
    return toConnection(must(await ctx.db.from("connections").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Connection not found."));
  });
}

export async function testDraft(integrationId: string, config: Record<string, string>, secret: string) {
  return act(async () => {
    await getContext("connections.manage");
    return testConnectionConfig(integrationId, config, secret);
  });
}

export async function createConnection(input: { integrationId: string; displayName: string; config: Record<string, string>; secret: string }) {
  return act(async (): Promise<Connection> => {
    const ctx = await getContext("connections.manage");
    const i = INTEGRATIONS.find((x) => x.id === input.integrationId);
    if (!i || i.availability !== "available" || !i.configFields.length) throw new ApiError("VALIDATION", "This integration can't be connected.");
    const errors = validateConfig(i, input.config);
    if (input.displayName.trim().length < 3) errors.displayName = "Use at least 3 characters.";
    if (!input.secret.trim()) errors.secret = "Enter the credential.";
    if (Object.keys(errors).length) throw new ApiError("VALIDATION", "Check the highlighted fields.", errors);
    const { count } = await ctx.db.from("connections").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).neq("status", "revoked");
    if ((count ?? 0) >= ctx.workspace.quotas.connections) throw new ApiError("CONFLICT", `This workspace allows ${ctx.workspace.quotas.connections} connections. Revoke one you no longer use first.`);
    const config = pickConfig(i, input.config, derivedFromSecret(i.id, input.secret));
    const test = await testConnectionConfig(i.id, config, input.secret.trim());
    const { data, error } = await ctx.db
      .from("connections")
      .insert({ workspace_id: ctx.workspace.id, integration_id: i.id, display_name: input.displayName.trim(), status: test.ok ? "connected" : "error", secret_hint: hintFor(i.id, input.secret), config, created_by: ctx.user.id, last_tested_at: ctx.now(), last_error: test.ok ? null : test.message })
      .select("*")
      .single();
    if (error?.code === "23505") throw new ApiError("CONFLICT", "Check the highlighted fields.", { displayName: "A connection with this name already exists." });
    const row = must({ data, error });
    await ctx.db.from("connection_secrets").insert({ connection_id: row.id, ciphertext: encryptSecret(input.secret.trim(), connectionSecretContext(row.id)) });
    await ctx.audit({ action: "connection.created", category: "connection", resourceType: "connection", resourceId: row.id, resourceName: row.display_name, metadata: { integration: i.name, testPassed: test.ok } });
    return toConnection(row);
  });
}

export async function updateConnection(id: string, input: { displayName: string; config: Record<string, string> }) {
  return act(async () => {
    const ctx = await getContext("connections.manage");
    const c = toConnection(must(await ctx.db.from("connections").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Connection not found."));
    if (c.status === "revoked") throw new ApiError("CONFLICT", "Revoked connections can't be edited.");
    const integ = INTEGRATIONS.find((x) => x.id === c.integrationId)!;
    const errors = validateConfig(integ, input.config);
    if (input.displayName.trim().length < 3) errors.displayName = "Use at least 3 characters.";
    if (Object.keys(errors).length) throw new ApiError("VALIDATION", "Check the highlighted fields.", errors);
    const keep: Record<string, string> = c.config.serviceAccountEmail ? { serviceAccountEmail: c.config.serviceAccountEmail } : {};
    const row = must(await ctx.db.from("connections").update({ display_name: input.displayName.trim(), config: pickConfig(integ, input.config, keep), status: "untested" }).eq("id", id).eq("workspace_id", ctx.workspace.id).select("*").single());
    await ctx.audit({ action: "connection.updated", category: "connection", resourceType: "connection", resourceId: id, resourceName: row.display_name, metadata: {} });
    return toConnection(row);
  });
}

async function secretFor(ctx: RequestContext, id: string) {
  const { data } = await ctx.db.from("connection_secrets").select("ciphertext").eq("connection_id", id).maybeSingle();
  const { decryptSecret } = await import("../crypto");
  return data ? decryptSecret(data.ciphertext, connectionSecretContext(id)) : "";
}

export async function testConnection(id: string) {
  return act(async () => {
    // Uses the stored credential against the vendor and rewrites the connection status: managers only.
    const ctx = await getContext("connections.manage");
    const c = toConnection(must(await ctx.db.from("connections").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Connection not found."));
    if (c.status === "revoked") throw new ApiError("CONFLICT", "This connection is revoked. Create a new one.");
    const res = await testConnectionConfig(c.integrationId, c.config, await secretFor(ctx, id));
    const row = must(await ctx.db.from("connections").update({ status: res.ok ? "connected" : "error", last_tested_at: ctx.now(), last_error: res.ok ? null : res.message }).eq("id", id).eq("workspace_id", ctx.workspace.id).select("*").single());
    await ctx.audit({ action: "connection.tested", category: "connection", resourceType: "connection", resourceId: id, resourceName: c.displayName, metadata: { result: res.ok ? "passed" : "failed" } });
    return { ...res, connection: toConnection(row) };
  });
}

export async function rotateConnection(id: string, secret: string) {
  return act(async () => {
    const ctx = await getContext("connections.manage");
    const c = toConnection(must(await ctx.db.from("connections").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Connection not found."));
    if (c.status === "revoked") throw new ApiError("CONFLICT", "Revoked connections can't be rotated.");
    if (!secret.trim()) throw new ApiError("VALIDATION", "Check the highlighted fields.", { secret: "Enter the new credential." });
    const config = { ...c.config, ...derivedFromSecret(c.integrationId, secret) };
    const res = await testConnectionConfig(c.integrationId, config, secret.trim());
    await ctx.db.from("connection_secrets").upsert({ connection_id: id, ciphertext: encryptSecret(secret.trim(), connectionSecretContext(id)) });
    const row = must(await ctx.db.from("connections").update({ config, secret_hint: hintFor(c.integrationId, secret), rotated_at: ctx.now(), last_tested_at: ctx.now(), status: res.ok ? "connected" : "error", last_error: res.ok ? null : res.message }).eq("id", id).eq("workspace_id", ctx.workspace.id).select("*").single());
    await ctx.audit({ action: "connection.rotated", category: "connection", resourceType: "connection", resourceId: id, resourceName: c.displayName, metadata: { testPassed: res.ok } });
    return toConnection(row);
  });
}

export async function revokeConnection(id: string) {
  return act(async () => {
    const ctx = await getContext("connections.manage");
    const c = toConnection(must(await ctx.db.from("connections").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Connection not found."));
    await ctx.db.from("connection_secrets").delete().eq("connection_id", id);
    const row = must(await ctx.db.from("connections").update({ status: "revoked", last_error: `Revoked by ${ctx.user.name}.` }).eq("id", id).eq("workspace_id", ctx.workspace.id).select("*").single());
    await ctx.audit({ action: "connection.revoked", category: "connection", resourceType: "connection", resourceId: id, resourceName: c.displayName, metadata: {} });
    return toConnection(row);
  });
}

/* ---------------- webhooks (INT-04) ---------------- */

const webhookUrl = (id: string) => `${env.appUrl}/api/v1/webhooks/${id}`;

export async function listWebhooks() {
  return act(async (): Promise<WebhookListItem[]> => {
    const ctx = await getContext("connections.view");
    const { data: eps } = await ctx.db.from("webhook_endpoints").select("*, workflows(name, status)").eq("workspace_id", ctx.workspace.id).order("created_at");
    const dayAgo = new Date(Date.now() - 86400_000).toISOString();
    const { data: ds } = await ctx.db.from("webhook_deliveries").select("*").eq("workspace_id", ctx.workspace.id).gte("received_at", new Date(Date.now() - 30 * 86400_000).toISOString()).order("received_at", { ascending: false }).limit(1000);
    return (eps ?? []).map((e) => {
      const mine = (ds ?? []).filter((d) => d.endpoint_id === e.id).map(toDelivery);
      return { ...toWebhook(e), workflowName: e.workflows?.name ?? "Deleted workflow", workflowStatus: e.workflows?.status ?? "archived", lastDelivery: mine[0], deliveries24h: mine.filter((d) => d.receivedAt > dayAgo).length, rejected24h: mine.filter((d) => d.receivedAt > dayAgo && d.status.startsWith("rejected")).length, url: webhookUrl(e.id) };
    });
  });
}

export async function getWebhook(id: string) {
  return act(async () => {
    const ctx = await getContext("connections.view");
    const e = must(await ctx.db.from("webhook_endpoints").select("*, workflows(name, status)").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Webhook endpoint not found.");
    const { data: ds } = await ctx.db.from("webhook_deliveries").select("*").eq("endpoint_id", id).order("received_at", { ascending: false }).limit(50);
    const deliveries = (ds ?? []).map(toDelivery);
    const dayAgo = new Date(Date.now() - 86400_000).toISOString();
    const endpoint: WebhookListItem = { ...toWebhook(e), workflowName: e.workflows?.name ?? "", workflowStatus: e.workflows?.status ?? "", lastDelivery: deliveries[0], deliveries24h: deliveries.filter((d) => d.receivedAt > dayAgo).length, rejected24h: deliveries.filter((d) => d.receivedAt > dayAgo && d.status.startsWith("rejected")).length, url: webhookUrl(e.id) };
    return { endpoint, deliveries };
  });
}

function secretLink(endpointId: string, value: string) {
  return `${env.appUrl}/api/v1/webhooks/${endpointId}?key=${encodeURIComponent(value)}`;
}

async function rotateSecretFor(ctx: RequestContext, ep: { id: string; name: string; verification: string }): Promise<OneTimeSecret> {
  const value = randomToken("whsec_");
  const hint = `whsec_${secretHint(value)}`;
  await ctx.db.from("webhook_secrets").upsert({ endpoint_id: ep.id, ciphertext: encryptSecret(value, webhookSecretContext(ep.id)) });
  await ctx.db.from("webhook_endpoints").update({ secret_hint: hint, rotated_at: ctx.now() }).eq("id", ep.id).eq("workspace_id", ctx.workspace.id);
  await ctx.audit({ action: "webhook.secret_rotated", category: "webhook", resourceType: "webhook_endpoint", resourceId: ep.id, resourceName: ep.name, metadata: { verification: ep.verification } });
  return { value, hint, ...(ep.verification === "url_key" ? { link: secretLink(ep.id, value) } : {}) };
}

/** Server-side bounds for webhook settings (keys match the form's field names). */
function webhookLimitErrors(input: { replayWindowSec: number; maxBodyKb: number; rateLimitPerMin: number }) {
  const errors: Record<string, string> = {};
  const int = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  if (!int(input.replayWindowSec, 30, 900)) errors.replayWindowSec = "Use between 30 and 900 seconds.";
  if (!int(input.maxBodyKb, 1, 1024)) errors.maxBodyKb = "Use 1–1024 KB.";
  if (!int(input.rateLimitPerMin, 1, 6000)) errors.rate = "Use 1–6000 per minute.";
  return errors;
}

export async function createWebhook(input: { name: string; workflowId: string; replayWindowSec: number; maxBodyKb: number; rateLimitPerMin: number; verification?: "hmac" | "url_key" }) {
  return act(async (): Promise<{ endpoint: WebhookEndpoint; secret: OneTimeSecret }> => {
    const ctx = await getContext("connections.manage");
    const errors: Record<string, string> = webhookLimitErrors(input);
    if (input.name.trim().length < 3) errors.name = "Use at least 3 characters.";
    const { data: wf } = await ctx.db.from("workflows").select("id, name").eq("id", input.workflowId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    if (!wf) errors.workflowId = "Choose a workflow.";
    if (Object.keys(errors).length) throw new ApiError("VALIDATION", "Check the highlighted fields.", errors);
    const value = randomToken("whsec_");
    const hint = `whsec_${secretHint(value)}`;
    const { data, error } = await ctx.db.from("webhook_endpoints").insert({ workspace_id: ctx.workspace.id, workflow_id: wf!.id, name: input.name.trim(), secret_hint: hint, replay_window_sec: input.replayWindowSec, max_body_kb: input.maxBodyKb, rate_limit_per_min: input.rateLimitPerMin, verification: input.verification === "url_key" ? "url_key" : "hmac" }).select("*").single();
    if (error?.code === "23505") throw new ApiError("VALIDATION", "Check the highlighted fields.", { workflowId: "This workflow already has an endpoint." });
    const row = must({ data, error });
    await ctx.db.from("webhook_secrets").insert({ endpoint_id: row.id, ciphertext: encryptSecret(value, webhookSecretContext(row.id)) });
    // Link the trigger to the endpoint for convenience.
    await ctx.audit({ action: "webhook.created", category: "webhook", resourceType: "webhook_endpoint", resourceId: row.id, resourceName: row.name, metadata: { workflow: wf!.name } });
    return { endpoint: toWebhook(row), secret: { value, hint, ...(row.verification === "url_key" ? { link: secretLink(row.id, value) } : {}) } };
  });
}

export async function updateWebhook(id: string, input: { name: string; status: "active" | "disabled"; replayWindowSec: number; maxBodyKb: number; rateLimitPerMin: number; verification?: "hmac" | "url_key"; headerKeyOnly?: boolean }) {
  return act(async () => {
    const ctx = await getContext("connections.manage");
    const errors = webhookLimitErrors(input);
    if (input.name.trim().length < 3) errors.name = "Use at least 3 characters.";
    if (input.status !== "active" && input.status !== "disabled") errors.status = "Choose a status.";
    if (Object.keys(errors).length) throw new ApiError("VALIDATION", "Check the highlighted fields.", errors);
    const before = must(await ctx.db.from("webhook_endpoints").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Webhook endpoint not found.");
    const verification = input.verification === "url_key" || input.verification === "hmac" ? input.verification : before.verification;
    // Only send header_key_only when it changes, so this keeps working before migration 0008 adds the column.
    const keyOnly = typeof input.headerKeyOnly === "boolean" && input.headerKeyOnly !== (before.header_key_only === true) ? { header_key_only: input.headerKeyOnly } : {};
    const row = must(await ctx.db.from("webhook_endpoints").update({ name: input.name.trim(), status: input.status, replay_window_sec: input.replayWindowSec, max_body_kb: input.maxBodyKb, rate_limit_per_min: input.rateLimitPerMin, verification, ...keyOnly }).eq("id", id).eq("workspace_id", ctx.workspace.id).select("*").single(), "Webhook endpoint not found.");
    await ctx.audit({ action: "webhook.updated", category: "webhook", resourceType: "webhook_endpoint", resourceId: id, resourceName: row.name, metadata: { status: input.status, verification } });
    // Switching how senders prove themselves invalidates what they have, so issue a fresh secret (and link).
    const secret = verification !== before.verification ? await rotateSecretFor(ctx, { id, name: row.name, verification }) : null;
    return { endpoint: toWebhook(row), secret };
  });
}

export async function rotateWebhookSecret(id: string) {
  return act(async (): Promise<OneTimeSecret> => {
    const ctx = await getContext("connections.manage");
    const ep = must(await ctx.db.from("webhook_endpoints").select("id, name, verification").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Webhook endpoint not found.");
    return rotateSecretFor(ctx, ep);
  });
}

/** Sends a sample event through the real ingest path (signature check skipped: the caller is signed in). */
export async function sendTestEvent(id: string, payload: Record<string, unknown>) {
  return act(async (): Promise<WebhookDelivery> => {
    const ctx = await getContext("connections.manage");
    const ep = must(await ctx.db.from("webhook_endpoints").select("id, name").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Webhook endpoint not found.");
    const headers = new Headers({ "x-brightrail-event-id": `test_${Date.now()}` });
    await ingestWebhook(id, JSON.stringify(payload), headers, { skipSignature: true });
    const { data } = await ctx.db.from("webhook_deliveries").select("*").eq("endpoint_id", id).order("received_at", { ascending: false }).limit(1).single();
    await ctx.audit({ action: "webhook.test_sent", category: "webhook", resourceType: "webhook_endpoint", resourceId: id, resourceName: ep.name, metadata: { runStarted: Boolean(data?.run_id) } });
    return toDelivery(data);
  });
}
