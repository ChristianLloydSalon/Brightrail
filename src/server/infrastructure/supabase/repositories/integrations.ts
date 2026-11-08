import "server-only";
import type { Connection, WebhookDelivery, WebhookEndpoint } from "@/lib/domain/types";
import type { ConnectionRepository, DeliveryRepository, WebhookRepository, WebhookWithWorkflow } from "@/server/application/ports/repositories";
import { must, mustUnique } from "../errors";
import { toConnection, toDelivery, toWebhook } from "../mappers";
import { columns, SupabaseRepository } from "./base";

export class SupabaseConnectionRepository extends SupabaseRepository implements ConnectionRepository {
  async listByWorkspace(workspaceId: string): Promise<Connection[]> {
    const { data } = await this.db.from("connections").select("*").eq("workspace_id", workspaceId).order("created_at");
    return (data ?? []).map(toConnection);
  }

  async findInWorkspace(workspaceId: string, id: string): Promise<Connection | null> {
    const { data } = await this.db.from("connections").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    return data ? toConnection(data) : null;
  }

  async findForExecution(id: string, workspaceId: string, integrationId: string): Promise<Connection | null> {
    const { data } = await this.db.from("connections").select("*").eq("id", id).eq("workspace_id", workspaceId).eq("integration_id", integrationId).maybeSingle();
    return data ? toConnection(data) : null;
  }

  async countActive(workspaceId: string): Promise<number> {
    const { count } = await this.db.from("connections").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "revoked");
    return count ?? 0;
  }

  async insert(row: Parameters<ConnectionRepository["insert"]>[0]): Promise<Connection> {
    return toConnection(mustUnique(await this.db.from("connections").insert({
      workspace_id: row.workspaceId, integration_id: row.integrationId, display_name: row.displayName, status: row.status, secret_hint: row.secretHint, config: row.config,
      created_by: row.createdBy, last_tested_at: row.lastTestedAt, last_error: row.lastError,
    }).select("*").single()));
  }

  async update(workspaceId: string, id: string, patch: Parameters<ConnectionRepository["update"]>[2]): Promise<Connection> {
    const cols = columns(patch, { displayName: "display_name", config: "config", status: "status", secretHint: "secret_hint", rotatedAt: "rotated_at", lastTestedAt: "last_tested_at", lastError: "last_error" });
    return toConnection(must(await this.db.from("connections").update(cols).eq("id", id).eq("workspace_id", workspaceId).select("*").single()));
  }
}

type EndpointRow = Record<string, unknown> & { workflows?: { name?: string; status?: string } | null };
const withWorkflow = (e: EndpointRow): WebhookWithWorkflow => ({ endpoint: toWebhook(e), workflowName: e.workflows?.name ?? null, workflowStatus: e.workflows?.status ?? null });

export class SupabaseWebhookRepository extends SupabaseRepository implements WebhookRepository {
  async byWorkflow(workflowId: string) {
    const { data } = await this.db.from("webhook_endpoints").select("id, name, status").eq("workflow_id", workflowId).maybeSingle();
    return (data as { id: string; name: string; status: string } | null) ?? null;
  }

  async countActive(workspaceId: string): Promise<number> {
    const { count } = await this.db.from("webhook_endpoints").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "active");
    return count ?? 0;
  }

  async listWithWorkflow(workspaceId: string): Promise<WebhookWithWorkflow[]> {
    const { data } = await this.db.from("webhook_endpoints").select("*, workflows(name, status)").eq("workspace_id", workspaceId).order("created_at");
    return (data ?? []).map((e) => withWorkflow(e as EndpointRow));
  }

  async getWithWorkflow(workspaceId: string, id: string): Promise<WebhookWithWorkflow | null> {
    const { data } = await this.db.from("webhook_endpoints").select("*, workflows(name, status)").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    return data ? withWorkflow(data as EndpointRow) : null;
  }

  async findInWorkspace(workspaceId: string, id: string): Promise<WebhookEndpoint | null> {
    const { data } = await this.db.from("webhook_endpoints").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    return data ? toWebhook(data) : null;
  }

  async findById(id: string): Promise<WebhookEndpoint | null> {
    const { data } = await this.db.from("webhook_endpoints").select("*").eq("id", id).maybeSingle();
    return data ? toWebhook(data) : null;
  }

  async insert(row: Parameters<WebhookRepository["insert"]>[0]): Promise<WebhookEndpoint> {
    return toWebhook(mustUnique(await this.db.from("webhook_endpoints").insert({
      workspace_id: row.workspaceId, workflow_id: row.workflowId, name: row.name, secret_hint: row.secretHint, replay_window_sec: row.replayWindowSec,
      max_body_kb: row.maxBodyKb, rate_limit_per_min: row.rateLimitPerMin, verification: row.verification,
    }).select("*").single()));
  }

  async update(workspaceId: string, id: string, patch: Parameters<WebhookRepository["update"]>[2]): Promise<WebhookEndpoint> {
    const cols = columns(patch, { name: "name", status: "status", replayWindowSec: "replay_window_sec", maxBodyKb: "max_body_kb", rateLimitPerMin: "rate_limit_per_min", verification: "verification", headerKeyOnly: "header_key_only" });
    return toWebhook(must(await this.db.from("webhook_endpoints").update(cols).eq("id", id).eq("workspace_id", workspaceId).select("*").single(), "Webhook endpoint not found."));
  }

  async setSecretHint(workspaceId: string, id: string, hint: string, rotatedAt: string): Promise<void> {
    await this.db.from("webhook_endpoints").update({ secret_hint: hint, rotated_at: rotatedAt }).eq("id", id).eq("workspace_id", workspaceId);
  }
}

export class SupabaseDeliveryRepository extends SupabaseRepository implements DeliveryRepository {
  async recentInWorkspace(workspaceId: string, since: string, limit: number): Promise<WebhookDelivery[]> {
    const { data } = await this.db.from("webhook_deliveries").select("*").eq("workspace_id", workspaceId).gte("received_at", since).order("received_at", { ascending: false }).limit(limit);
    return (data ?? []).map(toDelivery);
  }

  async forEndpoint(endpointId: string, limit: number): Promise<WebhookDelivery[]> {
    const { data } = await this.db.from("webhook_deliveries").select("*").eq("endpoint_id", endpointId).order("received_at", { ascending: false }).limit(limit);
    return (data ?? []).map(toDelivery);
  }

  async record(row: Parameters<DeliveryRepository["record"]>[0]): Promise<void> {
    await this.db.from("webhook_deliveries").insert({ workspace_id: row.workspaceId, endpoint_id: row.endpointId, event_id: row.eventId, status: row.status, http_status: row.httpStatus, bytes: row.bytes, run_id: row.runId ?? null });
  }

  async insertAccepted(row: Parameters<DeliveryRepository["insertAccepted"]>[0]): Promise<string | null> {
    const accepted: Record<string, unknown> = { workspace_id: row.workspaceId, endpoint_id: row.endpointId, event_id: row.eventId, status: "accepted", http_status: 202, bytes: row.bytes };
    let { data, error } = await this.db.from("webhook_deliveries").insert(row.signatureKey ? { ...accepted, signature_key: row.signatureKey } : accepted).select("id").single();
    if (error && row.signatureKey && /signature_key/.test(error.message)) {
      // Column missing (migration 0008 not applied yet): fall back to event-id-only idempotency.
      ({ data, error } = await this.db.from("webhook_deliveries").insert(accepted).select("id").single());
    }
    return error || !data ? null : (data.id as string);
  }

  async acceptedRunByEvent(endpointId: string, eventId: string) {
    const { data } = await this.db.from("webhook_deliveries").select("run_id").eq("endpoint_id", endpointId).eq("event_id", eventId).eq("status", "accepted").maybeSingle();
    return data ? { runId: (data.run_id as string | null) ?? null } : null;
  }

  async acceptedRunBySignature(endpointId: string, signatureKey: string) {
    // Needs 0008_security_fixes.sql; without the column this lookup errors and is skipped.
    const { data, error } = await this.db.from("webhook_deliveries").select("run_id").eq("endpoint_id", endpointId).eq("signature_key", signatureKey).eq("status", "accepted").maybeSingle();
    if (error) console.error("[brightrail] webhook signature dedupe unavailable — run supabase/migrations/0008_security_fixes.sql", error.message);
    return data ? { runId: (data.run_id as string | null) ?? null } : null;
  }

  async attachRun(deliveryId: string, runId: string): Promise<void> {
    await this.db.from("webhook_deliveries").update({ run_id: runId }).eq("id", deliveryId);
  }

  async delete(deliveryId: string): Promise<void> {
    await this.db.from("webhook_deliveries").delete().eq("id", deliveryId);
  }
}
