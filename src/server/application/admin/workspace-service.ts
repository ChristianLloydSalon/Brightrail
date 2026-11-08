import { ApiError } from "@/lib/api-error";
import { CONFIGURABLE_GRANT_KEYS } from "@/lib/domain/permissions";
import { PLANS, type PlanId } from "@/lib/domain/plans";
import { monthStartUtc } from "@/lib/domain/run-rules";
import type { GrantKey, Role, Workspace, WorkspaceSettings } from "@/lib/domain/types";
import { changedSettings, validateWorkspaceSettings } from "@/lib/domain/workspace-rules";
import type { ConnectionRepository, MemberRepository, RunRepository, WorkspaceRepository } from "../ports/repositories";
import type { WorkspacePreference } from "../ports/services";
import type { AuditLog } from "../shared/audit-log";
import type { RequestContext } from "../shared/context";
import { assertNoFieldErrors, fieldError, onDuplicate } from "../shared/errors";

/** Workspace settings, permissions, plan and lifecycle. */
export class WorkspaceService {
  constructor(
    private readonly workspaces: WorkspaceRepository,
    private readonly members: MemberRepository,
    private readonly runs: RunRepository,
    private readonly connections: ConnectionRepository,
    private readonly preference: WorkspacePreference,
    private readonly audit: AuditLog,
  ) {}

  async get(ctx: RequestContext): Promise<Workspace & { memberCount: number; role: Role }> {
    return { ...ctx.workspace, memberCount: await this.members.countSeated(ctx.workspaceId), role: ctx.member.role };
  }

  async update(ctx: RequestContext, input: { name: string; slug: string; settings: WorkspaceSettings }): Promise<Workspace> {
    const { errors, slug, settings } = validateWorkspaceSettings(input);
    assertNoFieldErrors(errors);
    const ws = await onDuplicate(() => this.workspaces.update(ctx.workspaceId, { name: input.name.trim(), slug, settings }), () => fieldError({ slug: "This URL is taken." }));
    const changed = changedSettings(settings, ctx.workspace.settings);
    await this.audit.record(ctx, { action: "workspace.settings_updated", category: "workspace", resourceType: "workspace", resourceId: ctx.workspaceId, resourceName: ws.name, metadata: { fields: changed.join(", ") || "name" } });
    return ws;
  }

  async updateGrants(ctx: RequestContext, grants: Partial<Record<GrantKey, boolean>>): Promise<Workspace> {
    if (!grants || typeof grants !== "object" || Array.isArray(grants)) throw new ApiError("VALIDATION", "Invalid permissions.");
    for (const [k, v] of Object.entries(grants)) if (!CONFIGURABLE_GRANT_KEYS.has(k) || typeof v !== "boolean") throw new ApiError("VALIDATION", "That permission can't be changed.");
    const ws = await this.workspaces.update(ctx.workspaceId, { grants: { ...ctx.workspace.grants, ...grants } });
    for (const [k, v] of Object.entries(grants)) await this.audit.record(ctx, { action: "workspace.grants_updated", category: "workspace", resourceType: "workspace", resourceId: ctx.workspaceId, resourceName: ctx.workspace.name, metadata: { grant: k, enabled: Boolean(v) } });
    return ws;
  }

  async remove(ctx: RequestContext, confirmName: string) {
    if (!ctx.isOwner) throw new ApiError("FORBIDDEN", "Only the workspace owner can delete it.");
    if (confirmName.trim() !== ctx.workspace.name) throw new ApiError("VALIDATION", "Type the workspace name exactly to confirm.", { confirm: "The name doesn't match." });
    await this.workspaces.delete(ctx.workspaceId);
    await this.preference.clear();
    return { ok: true };
  }

  /** Usage against the workspace's limits, for Settings → Plan & usage. */
  async planUsage(ctx: RequestContext) {
    const now = new Date();
    const [executions, members, connections] = await Promise.all([
      this.runs.countSince(ctx.workspaceId, monthStartUtc(now).toISOString()),
      this.members.countSeated(ctx.workspaceId),
      this.connections.countActive(ctx.workspaceId),
    ]);
    return {
      plan: ctx.workspace.plan,
      quotas: ctx.workspace.quotas,
      usage: { executions, members, connections },
      resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
      canChange: ctx.isOwner,
    };
  }

  /** Owner switches plan; limits change immediately. No payment is taken. */
  async changePlan(ctx: RequestContext, plan: PlanId) {
    if (!ctx.isOwner) throw new ApiError("FORBIDDEN", "Only the workspace owner can change the plan.");
    const target = PLANS[plan];
    if (!target) throw new ApiError("VALIDATION", "Choose a plan.");
    if (ctx.workspace.plan === plan) return { plan };
    await this.workspaces.update(ctx.workspaceId, { plan, quotas: target.quotas });
    await this.audit.record(ctx, { action: "workspace.plan_changed", category: "workspace", resourceType: "workspace", resourceId: ctx.workspaceId, resourceName: ctx.workspace.name, metadata: { from: ctx.workspace.plan, to: plan } });
    return { plan };
  }
}
