"use server";

import type { IntegrationCategory } from "@/lib/domain/types";
import { inWorkspace } from "../presentation/action";

export type { IntegrationListItem } from "../application/integrations/connection-service";
export type { OneTimeSecret, WebhookListItem } from "../application/integrations/webhook-endpoint-service";

type WebhookLimits = { replayWindowSec: number; maxBodyKb: number; rateLimitPerMin: number };
type Verification = "hmac" | "url_key";

/* ---------------- integrations & connections ---------------- */

export async function list(params: { search?: string; category?: IntegrationCategory | "all" } = {}) {
  return inWorkspace("connections.view", (app, ctx) => app.connections.list(ctx, params));
}

export async function get(id: string) {
  return inWorkspace("connections.view", (app, ctx) => app.connections.get(ctx, id));
}

export async function connections() {
  return inWorkspace("connections.view", (app, ctx) => app.connections.all(ctx));
}

export async function getConnection(id: string) {
  return inWorkspace("connections.view", (app, ctx) => app.connections.getOne(ctx, id));
}

export async function testDraft(integrationId: string, config: Record<string, string>, secret: string) {
  return inWorkspace("connections.manage", (app) => app.connections.testDraft(integrationId, config, secret));
}

export async function createConnection(input: { integrationId: string; displayName: string; config: Record<string, string>; secret: string }) {
  return inWorkspace("connections.manage", (app, ctx) => app.connections.create(ctx, input));
}

export async function updateConnection(id: string, input: { displayName: string; config: Record<string, string> }) {
  return inWorkspace("connections.manage", (app, ctx) => app.connections.update(ctx, id, input));
}

/** Uses the stored credential against the vendor and rewrites the connection status: managers only. */
export async function testConnection(id: string) {
  return inWorkspace("connections.manage", (app, ctx) => app.connections.test(ctx, id));
}

export async function rotateConnection(id: string, secret: string) {
  return inWorkspace("connections.manage", (app, ctx) => app.connections.rotate(ctx, id, secret));
}

export async function revokeConnection(id: string) {
  return inWorkspace("connections.manage", (app, ctx) => app.connections.revoke(ctx, id));
}

/* ---------------- webhooks (INT-04) ---------------- */

export async function listWebhooks() {
  return inWorkspace("connections.view", (app, ctx) => app.webhooks.list(ctx));
}

export async function getWebhook(id: string) {
  return inWorkspace("connections.view", (app, ctx) => app.webhooks.get(ctx, id));
}

export async function createWebhook(input: WebhookLimits & { name: string; workflowId: string; verification?: Verification }) {
  return inWorkspace("connections.manage", (app, ctx) => app.webhooks.create(ctx, input));
}

export async function updateWebhook(id: string, input: WebhookLimits & { name: string; status: "active" | "disabled"; verification?: Verification; headerKeyOnly?: boolean }) {
  return inWorkspace("connections.manage", (app, ctx) => app.webhooks.update(ctx, id, input));
}

export async function rotateWebhookSecret(id: string) {
  return inWorkspace("connections.manage", (app, ctx) => app.webhooks.rotateSecret(ctx, id));
}

/** Sends a sample event through the real ingest path (signature check skipped: the caller is signed in). */
export async function sendTestEvent(id: string, payload: Record<string, unknown>) {
  return inWorkspace("connections.manage", (app, ctx) => app.webhooks.sendTestEvent(ctx, id, payload));
}
