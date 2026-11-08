import { secretHint } from "@/lib/domain/redaction";
import type { WebhookDelivery, WebhookEndpoint } from "@/lib/domain/types";
import type { DeliveryRepository, WebhookRepository, WebhookWithWorkflow, WorkflowRepository } from "../ports/repositories";
import type { AppConfig, Hasher, SecretStore } from "../ports/services";
import type { AuditLog } from "../shared/audit-log";
import type { RequestContext } from "../shared/context";
import { assertNoFieldErrors, fieldError, found, onDuplicate } from "../shared/errors";
import { webhookLimitErrors } from "./connection-rules";
import type { WebhookIngestService } from "./webhook-ingest-service";

/** Shown once. `link` is the full webhook URL including the key, for secret-link endpoints. */
export interface OneTimeSecret { value: string; hint: string; link?: string }
export interface WebhookListItem extends WebhookEndpoint { workflowName: string; workflowStatus: string; lastDelivery?: WebhookDelivery; deliveries24h: number; rejected24h: number; url: string }

type Limits = { replayWindowSec: number; maxBodyKb: number; rateLimitPerMin: number };
type Verification = WebhookEndpoint["verification"];

/** Inbound webhook endpoints: their settings, signing secrets and delivery history. */
export class WebhookEndpointService {
  constructor(
    private readonly webhooks: WebhookRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly workflows: WorkflowRepository,
    private readonly secrets: SecretStore,
    private readonly hasher: Hasher,
    private readonly ingest: WebhookIngestService,
    private readonly audit: AuditLog,
    private readonly config: AppConfig,
  ) {}

  private url(id: string) {
    return `${this.config.appUrl}/api/v1/webhooks/${id}`;
  }

  private secretLink(id: string, value: string) {
    return `${this.url(id)}?key=${encodeURIComponent(value)}`;
  }

  private item(w: WebhookWithWorkflow, deliveries: WebhookDelivery[], fallback: string): WebhookListItem {
    const dayAgo = new Date(Date.now() - 86400_000).toISOString();
    const recent = deliveries.filter((d) => d.receivedAt > dayAgo);
    return { ...w.endpoint, workflowName: w.workflowName ?? fallback, workflowStatus: w.workflowStatus ?? (fallback ? "archived" : ""), lastDelivery: deliveries[0], deliveries24h: recent.length, rejected24h: recent.filter((d) => d.status.startsWith("rejected")).length, url: this.url(w.endpoint.id) };
  }

  async list(ctx: RequestContext): Promise<WebhookListItem[]> {
    const eps = await this.webhooks.listWithWorkflow(ctx.workspaceId);
    const ds = await this.deliveries.recentInWorkspace(ctx.workspaceId, new Date(Date.now() - 30 * 86400_000).toISOString(), 1000);
    return eps.map((e) => this.item(e, ds.filter((d) => d.endpointId === e.endpoint.id), "Deleted workflow"));
  }

  async get(ctx: RequestContext, id: string) {
    const e = found(await this.webhooks.getWithWorkflow(ctx.workspaceId, id), "Webhook endpoint not found.");
    const deliveries = await this.deliveries.forEndpoint(id, 50);
    return { endpoint: this.item(e, deliveries, ""), deliveries };
  }

  /** Issues a fresh secret, stores it encrypted and returns it once. */
  private async issueSecret(ctx: RequestContext, ep: { id: string; verification: Verification }): Promise<OneTimeSecret> {
    const value = this.hasher.randomToken("whsec_");
    const hint = `whsec_${secretHint(value)}`;
    await this.secrets.write(ep.id, value);
    await this.webhooks.setSecretHint(ctx.workspaceId, ep.id, hint, new Date().toISOString());
    return { value, hint, ...(ep.verification === "url_key" ? { link: this.secretLink(ep.id, value) } : {}) };
  }

  private async rotateSecretFor(ctx: RequestContext, ep: { id: string; name: string; verification: Verification }): Promise<OneTimeSecret> {
    const secret = await this.issueSecret(ctx, ep);
    await this.audit.record(ctx, { action: "webhook.secret_rotated", category: "webhook", resourceType: "webhook_endpoint", resourceId: ep.id, resourceName: ep.name, metadata: { verification: ep.verification } });
    return secret;
  }

  async create(ctx: RequestContext, input: Limits & { name: string; workflowId: string; verification?: Verification }): Promise<{ endpoint: WebhookEndpoint; secret: OneTimeSecret }> {
    const errors = webhookLimitErrors(input);
    if (input.name.trim().length < 3) errors.name = "Use at least 3 characters.";
    const wf = await this.workflows.findInWorkspace(ctx.workspaceId, input.workflowId);
    if (!wf) errors.workflowId = "Choose a workflow.";
    assertNoFieldErrors(errors);
    const value = this.hasher.randomToken("whsec_");
    const endpoint = await onDuplicate(
      () => this.webhooks.insert({ workspaceId: ctx.workspaceId, workflowId: wf!.id, name: input.name.trim(), secretHint: `whsec_${secretHint(value)}`, replayWindowSec: input.replayWindowSec, maxBodyKb: input.maxBodyKb, rateLimitPerMin: input.rateLimitPerMin, verification: input.verification === "url_key" ? "url_key" : "hmac" }),
      () => fieldError({ workflowId: "This workflow already has an endpoint." }),
    );
    await this.secrets.write(endpoint.id, value);
    await this.audit.record(ctx, { action: "webhook.created", category: "webhook", resourceType: "webhook_endpoint", resourceId: endpoint.id, resourceName: endpoint.name, metadata: { workflow: wf!.name } });
    return { endpoint, secret: { value, hint: endpoint.secretHint, ...(endpoint.verification === "url_key" ? { link: this.secretLink(endpoint.id, value) } : {}) } };
  }

  async update(ctx: RequestContext, id: string, input: Limits & { name: string; status: "active" | "disabled"; verification?: Verification; headerKeyOnly?: boolean }) {
    const errors = webhookLimitErrors(input);
    if (input.name.trim().length < 3) errors.name = "Use at least 3 characters.";
    if (input.status !== "active" && input.status !== "disabled") errors.status = "Choose a status.";
    assertNoFieldErrors(errors);
    const before = found(await this.webhooks.findInWorkspace(ctx.workspaceId, id), "Webhook endpoint not found.");
    const verification = input.verification === "url_key" || input.verification === "hmac" ? input.verification : before.verification;
    // Only send header_key_only when it changes, so this keeps working before migration 0008 adds the column.
    const keyOnly = typeof input.headerKeyOnly === "boolean" && input.headerKeyOnly !== before.headerKeyOnly ? { headerKeyOnly: input.headerKeyOnly } : {};
    const endpoint = await this.webhooks.update(ctx.workspaceId, id, { name: input.name.trim(), status: input.status, replayWindowSec: input.replayWindowSec, maxBodyKb: input.maxBodyKb, rateLimitPerMin: input.rateLimitPerMin, verification, ...keyOnly });
    await this.audit.record(ctx, { action: "webhook.updated", category: "webhook", resourceType: "webhook_endpoint", resourceId: id, resourceName: endpoint.name, metadata: { status: input.status, verification } });
    // Switching how senders prove themselves invalidates what they have, so issue a fresh secret (and link).
    const secret = verification !== before.verification ? await this.rotateSecretFor(ctx, { id, name: endpoint.name, verification }) : null;
    return { endpoint, secret };
  }

  async rotateSecret(ctx: RequestContext, id: string): Promise<OneTimeSecret> {
    const ep = found(await this.webhooks.findInWorkspace(ctx.workspaceId, id), "Webhook endpoint not found.");
    return this.rotateSecretFor(ctx, ep);
  }

  /** Sends a sample event through the real ingest path (signature check skipped: the caller is signed in). */
  async sendTestEvent(ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<WebhookDelivery> {
    const ep = found(await this.webhooks.findInWorkspace(ctx.workspaceId, id), "Webhook endpoint not found.");
    await this.ingest.ingest(id, JSON.stringify(payload), new Headers({ "x-brightrail-event-id": `test_${Date.now()}` }), { skipSignature: true });
    const [latest] = await this.deliveries.forEndpoint(id, 1);
    await this.audit.record(ctx, { action: "webhook.test_sent", category: "webhook", resourceType: "webhook_endpoint", resourceId: id, resourceName: ep.name, metadata: { runStarted: Boolean(latest?.runId) } });
    return latest!;
  }
}
