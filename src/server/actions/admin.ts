"use server";

import type { PlanId } from "@/lib/domain/plans";
import type { ApiKeyScope, GrantKey, Member, Role, WorkspaceSettings } from "@/lib/domain/types";
import type { AuditParams } from "../application/admin/audit-service";
import { inWorkspace } from "../presentation/action";

export type { AuditParams } from "../application/admin/audit-service";
export type { DashboardData } from "../application/admin/dashboard-service";
export type { MemberRow } from "../application/admin/member-service";

/* ---------------- workspace ---------------- */

export async function getWorkspace() {
  return inWorkspace(undefined, (app, ctx) => app.workspace.get(ctx));
}

export async function updateWorkspace(input: { name: string; slug: string; settings: WorkspaceSettings }) {
  return inWorkspace("workspace.manage", (app, ctx) => app.workspace.update(ctx, input));
}

export async function updateGrants(grants: Partial<Record<GrantKey, boolean>>) {
  return inWorkspace("members.manage", (app, ctx) => app.workspace.updateGrants(ctx, grants));
}

export async function removeWorkspace(confirmName: string) {
  return inWorkspace("workspace.delete", (app, ctx) => app.workspace.remove(ctx, confirmName));
}

/** Usage against the workspace's limits, for Settings → Plan & usage. */
export async function planUsage() {
  return inWorkspace("workspace.manage", (app, ctx) => app.workspace.planUsage(ctx));
}

/** Owner switches plan; limits change immediately. No payment is taken. */
export async function changePlan(plan: PlanId) {
  return inWorkspace("workspace.manage", (app, ctx) => app.workspace.changePlan(ctx, plan));
}

/* ---------------- members ---------------- */

export async function listMembers(params: { search?: string; role?: Role | "all"; status?: Member["status"] | "all" } = {}) {
  return inWorkspace("members.view", (app, ctx) => app.members.list(ctx, params));
}

export async function inviteMembers(input: { emails: string[]; role: Role; message?: string }) {
  return inWorkspace("members.manage", (app, ctx) => app.members.invite(ctx, input));
}

export async function changeRole(memberId: string, role: Role) {
  return inWorkspace("members.manage", (app, ctx) => app.members.changeRole(ctx, memberId, role));
}

/** Owner hands the workspace to another active member; the previous owner becomes an Admin. */
export async function transferOwnership(memberId: string) {
  return inWorkspace("workspace.delete", (app, ctx) => app.members.transferOwnership(ctx, memberId)); // owner-only permission
}

export async function setSuspended(memberId: string, suspended: boolean) {
  return inWorkspace("members.manage", (app, ctx) => app.members.setSuspended(ctx, memberId, suspended));
}

export async function removeMember(memberId: string) {
  return inWorkspace("members.manage", (app, ctx) => app.members.remove(ctx, memberId));
}

export async function resendInvite(memberId: string) {
  return inWorkspace("members.manage", (app, ctx) => app.members.resendInvite(ctx, memberId));
}

/* ---------------- API keys ---------------- */

export async function listApiKeys() {
  return inWorkspace("apikeys.manage", (app, ctx) => app.apiKeys.list(ctx));
}

export async function createApiKey(input: { name: string; scopes: ApiKeyScope[]; expiresInDays: number | null }) {
  return inWorkspace("apikeys.manage", (app, ctx) => app.apiKeys.create(ctx, input));
}

export async function revokeApiKey(id: string) {
  return inWorkspace("apikeys.manage", (app, ctx) => app.apiKeys.revoke(ctx, id));
}

/* ---------------- audit ---------------- */

export async function listAudit(params: AuditParams = {}) {
  return inWorkspace("audit.view", (app, ctx) => app.audit.list(ctx, params));
}

export async function auditActors() {
  return inWorkspace("audit.view", (app, ctx) => app.audit.actors(ctx));
}

/* ---------------- dashboard & notifications ---------------- */

export async function dashboard() {
  return inWorkspace("runs.view", (app, ctx) => app.dashboard.get(ctx));
}

export async function listNotifications() {
  return inWorkspace(undefined, (app, ctx) => app.notifications.list(ctx));
}

export async function unreadCounts() {
  return inWorkspace(undefined, (app, ctx) => app.notifications.badgeCounts(ctx));
}

export async function markNotificationsRead(ids: string[] | "all") {
  return inWorkspace(undefined, (app, ctx) => app.notifications.markRead(ctx, ids));
}
