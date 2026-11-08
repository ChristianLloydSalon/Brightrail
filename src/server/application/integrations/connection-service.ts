import { ApiError } from "@/lib/api-error";
import type { Connection, Integration, IntegrationCategory } from "@/lib/domain/types";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import type { ConnectionRepository, ScheduleRepository, WebhookRepository, WorkflowRepository } from "../ports/repositories";
import type { ConnectionTester, SecretStore } from "../ports/services";
import type { AuditLog } from "../shared/audit-log";
import type { RequestContext } from "../shared/context";
import { assertNoFieldErrors, fieldError, found, onDuplicate } from "../shared/errors";
import { configErrors, derivedFromSecret, hintFor, integrationStatus, pickConfig, type IntegrationStatus } from "./connection-rules";

export interface IntegrationListItem extends Integration {
  connectionCount: number;
  status: IntegrationStatus;
}

/** The integration directory and the workspace's credentialed connections to it. */
export class ConnectionService {
  constructor(
    private readonly connections: ConnectionRepository,
    private readonly webhooks: WebhookRepository,
    private readonly schedules: ScheduleRepository,
    private readonly workflows: WorkflowRepository,
    private readonly secrets: SecretStore,
    private readonly tester: ConnectionTester,
    private readonly audit: AuditLog,
  ) {}

  private async find(ctx: RequestContext, id: string): Promise<Connection> {
    return found(await this.connections.findInWorkspace(ctx.workspaceId, id), "Connection not found.");
  }

  async list(ctx: RequestContext, params: { search?: string; category?: IntegrationCategory | "all" } = {}): Promise<IntegrationListItem[]> {
    const conns = await this.connections.listByWorkspace(ctx.workspaceId);
    const webhooks = await this.webhooks.countActive(ctx.workspaceId);
    const schedules = await this.schedules.countEnabled(ctx.workspaceId);
    let items = INTEGRATIONS.map((i) => ({
      ...i,
      connectionCount: i.id === "int_webhook" ? webhooks : i.id === "int_schedule" ? schedules : conns.filter((c) => c.integrationId === i.id && c.status !== "revoked").length,
      status: integrationStatus(i, conns, webhooks, schedules),
    }));
    if (params.category && params.category !== "all") items = items.filter((i) => i.category === params.category);
    const q = params.search?.trim().toLowerCase();
    if (q) items = items.filter((i) => [i.name, i.vendor, i.summary, i.category, ...i.actions.map((a) => a.name)].some((t) => t.toLowerCase().includes(q)));
    return items;
  }

  async get(ctx: RequestContext, id: string) {
    const i = found(INTEGRATIONS.find((x) => x.id === id), "Integration not found.");
    const conns = (await this.connections.listByWorkspace(ctx.workspaceId)).filter((c) => c.integrationId === id);
    const wfs = await this.workflows.listByWorkspace(ctx.workspaceId);
    const connections = conns.map((c) => ({ ...c, usedBy: wfs.filter((w) => JSON.stringify(w.draft).includes(c.id)).map((w) => ({ id: w.id, name: w.name })) }));
    const schedules = i.id === "int_schedule" ? await this.schedules.countEnabled(ctx.workspaceId) : 0;
    return { integration: { ...i, connectionCount: i.id === "int_schedule" ? schedules : connections.length, status: integrationStatus(i, conns, 0, schedules) } as IntegrationListItem, connections };
  }

  all(ctx: RequestContext): Promise<Connection[]> {
    return this.connections.listByWorkspace(ctx.workspaceId);
  }

  getOne(ctx: RequestContext, id: string): Promise<Connection> {
    return this.find(ctx, id);
  }

  testDraft(integrationId: string, config: Record<string, string>, secret: string) {
    return this.tester.test(integrationId, config, secret);
  }

  async create(ctx: RequestContext, input: { integrationId: string; displayName: string; config: Record<string, string>; secret: string }): Promise<Connection> {
    const i = INTEGRATIONS.find((x) => x.id === input.integrationId);
    if (!i || i.availability !== "available" || !i.configFields.length) throw new ApiError("VALIDATION", "This integration can't be connected.");
    const errors = configErrors(i, input.config);
    if (input.displayName.trim().length < 3) errors.displayName = "Use at least 3 characters.";
    if (!input.secret.trim()) errors.secret = "Enter the credential.";
    assertNoFieldErrors(errors);
    const quota = ctx.workspace.quotas.connections;
    if ((await this.connections.countActive(ctx.workspaceId)) >= quota) throw new ApiError("CONFLICT", `This workspace allows ${quota} connections. Revoke one you no longer use first.`);
    const config = pickConfig(i, input.config, derivedFromSecret(i.id, input.secret));
    const test = await this.tester.test(i.id, config, input.secret.trim());
    const conn = await onDuplicate(
      () => this.connections.insert({ workspaceId: ctx.workspaceId, integrationId: i.id, displayName: input.displayName.trim(), status: test.ok ? "connected" : "error", secretHint: hintFor(i.id, input.secret), config, createdBy: ctx.user.id, lastTestedAt: new Date().toISOString(), lastError: test.ok ? null : test.message }),
      () => fieldError({ displayName: "A connection with this name already exists." }, "CONFLICT"),
    );
    await this.secrets.write(conn.id, input.secret.trim());
    await this.audit.record(ctx, { action: "connection.created", category: "connection", resourceType: "connection", resourceId: conn.id, resourceName: conn.displayName, metadata: { integration: i.name, testPassed: test.ok } });
    return conn;
  }

  async update(ctx: RequestContext, id: string, input: { displayName: string; config: Record<string, string> }): Promise<Connection> {
    const c = await this.find(ctx, id);
    if (c.status === "revoked") throw new ApiError("CONFLICT", "Revoked connections can't be edited.");
    const integ = INTEGRATIONS.find((x) => x.id === c.integrationId)!;
    const errors = configErrors(integ, input.config);
    if (input.displayName.trim().length < 3) errors.displayName = "Use at least 3 characters.";
    assertNoFieldErrors(errors);
    const keep: Record<string, string> = c.config.serviceAccountEmail ? { serviceAccountEmail: c.config.serviceAccountEmail } : {};
    const updated = await this.connections.update(ctx.workspaceId, id, { displayName: input.displayName.trim(), config: pickConfig(integ, input.config, keep), status: "untested" });
    await this.audit.record(ctx, { action: "connection.updated", category: "connection", resourceType: "connection", resourceId: id, resourceName: updated.displayName, metadata: {} });
    return updated;
  }

  /** Uses the stored credential against the vendor and rewrites the connection status. */
  async test(ctx: RequestContext, id: string) {
    const c = await this.find(ctx, id);
    if (c.status === "revoked") throw new ApiError("CONFLICT", "This connection is revoked. Create a new one.");
    const res = await this.tester.test(c.integrationId, c.config, (await this.secrets.read(id)) ?? "");
    const updated = await this.connections.update(ctx.workspaceId, id, { status: res.ok ? "connected" : "error", lastTestedAt: new Date().toISOString(), lastError: res.ok ? null : res.message });
    await this.audit.record(ctx, { action: "connection.tested", category: "connection", resourceType: "connection", resourceId: id, resourceName: c.displayName, metadata: { result: res.ok ? "passed" : "failed" } });
    return { ...res, connection: updated };
  }

  async rotate(ctx: RequestContext, id: string, secret: string): Promise<Connection> {
    const c = await this.find(ctx, id);
    if (c.status === "revoked") throw new ApiError("CONFLICT", "Revoked connections can't be rotated.");
    if (!secret.trim()) throw fieldError({ secret: "Enter the new credential." });
    const config = { ...c.config, ...derivedFromSecret(c.integrationId, secret) };
    const res = await this.tester.test(c.integrationId, config, secret.trim());
    await this.secrets.write(id, secret.trim());
    const now = new Date().toISOString();
    const updated = await this.connections.update(ctx.workspaceId, id, { config, secretHint: hintFor(c.integrationId, secret), rotatedAt: now, lastTestedAt: now, status: res.ok ? "connected" : "error", lastError: res.ok ? null : res.message });
    await this.audit.record(ctx, { action: "connection.rotated", category: "connection", resourceType: "connection", resourceId: id, resourceName: c.displayName, metadata: { testPassed: res.ok } });
    return updated;
  }

  async revoke(ctx: RequestContext, id: string): Promise<Connection> {
    const c = await this.find(ctx, id);
    await this.secrets.remove(id);
    const updated = await this.connections.update(ctx.workspaceId, id, { status: "revoked", lastError: `Revoked by ${ctx.user.name}.` });
    await this.audit.record(ctx, { action: "connection.revoked", category: "connection", resourceType: "connection", resourceId: id, resourceName: c.displayName, metadata: {} });
    return updated;
  }
}
