"use server";

import { cookies } from "next/headers";
import { authEmailsEnabled, callbackLink, sendEmail } from "../auth-emails";
import { ROLE_LABELS } from "@/lib/domain/permissions";
import { PLANS, type PlanId } from "@/lib/domain/plans";
import { ApiError, type Page } from "@/lib/api-error";
import { assignableRoles, CONFIGURABLE_GRANT_KEYS } from "@/lib/domain/permissions";
import { API_KEY_SCOPES } from "@/lib/domain/types";
import type { ApiKey, ApiKeyScope, AppNotification, AuditCategory, AuditEvent, GrantKey, Member, Role, RunStatus, Workspace, WorkspaceSettings } from "@/lib/domain/types";
import { slugify } from "@/lib/utils";
import { act, getContext, must, WS_COOKIE } from "../context";
import { randomToken, sha256 } from "../crypto";
import { env } from "../env";
import { toApiKey, toAudit, toMember, toNotification, toWorkspace } from "../rows";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface MemberRow extends Member { isYou: boolean }

/* ---------------- workspace ---------------- */

export async function getWorkspace() {
  return act(async (): Promise<Workspace & { memberCount: number; role: Role }> => {
    const ctx = await getContext();
    const { count } = await ctx.db.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).neq("status", "suspended");
    return { ...ctx.workspace, memberCount: count ?? 0, role: ctx.member.role };
  });
}

export async function updateWorkspace(input: { name: string; slug: string; settings: WorkspaceSettings }) {
  return act(async () => {
    const ctx = await getContext("workspace.manage");
    const errors: Record<string, string> = {};
    if (input.name.trim().length < 2) errors.name = "Use at least 2 characters.";
    const slug = slugify(input.slug);
    if (!/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/.test(slug)) errors.slug = "Use 3–48 lowercase letters, numbers and hyphens.";
    const r = input.settings.defaultRetry;
    if (r.maxAttempts < 1 || r.maxAttempts > 10) errors.maxAttempts = "Use between 1 and 10.";
    if (r.initialIntervalSec < 1 || r.initialIntervalSec > 300) errors.initialIntervalSec = "Use between 1 and 300 seconds.";
    if (r.maxIntervalSec < r.initialIntervalSec) errors.maxIntervalSec = "Must be at least the initial interval.";
    if (![7, 14, 30, 90].includes(input.settings.retentionDays)) errors.retentionDays = "Choose 7, 14, 30 or 90 days.";
    const s = input.settings;
    if (!Number.isFinite(r.backoffCoefficient) || r.backoffCoefficient < 1 || r.backoffCoefficient > 10) errors.backoffCoefficient = "Use between 1 and 10.";
    if (!Number.isInteger(s.approvalExpiryHours) || s.approvalExpiryHours < 1 || s.approvalExpiryHours > 168) errors.approvalExpiryHours = "Use between 1 and 168 hours.";
    if (s.payloadStorage !== "redacted" && s.payloadStorage !== "minimal") errors.payloadStorage = "Choose a payload storage option.";
    if (typeof s.aiAssistantEnabled !== "boolean") errors.aiAssistantEnabled = "Choose on or off.";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: s.timezone });
    } catch {
      errors.timezone = "Choose a valid time zone.";
    }
    if (Object.keys(errors).length) throw new ApiError("VALIDATION", "Check the highlighted fields.", errors);
    // Store only the known settings, never extra keys sent by a client.
    const settings: WorkspaceSettings = {
      timezone: s.timezone, retentionDays: s.retentionDays, payloadStorage: s.payloadStorage, aiAssistantEnabled: s.aiAssistantEnabled, approvalExpiryHours: s.approvalExpiryHours,
      defaultRetry: { maxAttempts: r.maxAttempts, initialIntervalSec: r.initialIntervalSec, backoffCoefficient: r.backoffCoefficient, maxIntervalSec: r.maxIntervalSec },
    };
    input = { ...input, settings };
    const { data, error } = await ctx.db.from("workspaces").update({ name: input.name.trim(), slug, settings }).eq("id", ctx.workspace.id).select("*").single();
    if (error?.code === "23505") throw new ApiError("VALIDATION", "Check the highlighted fields.", { slug: "This URL is taken." });
    const row = must({ data, error });
    const changed = Object.keys(input.settings).filter((k) => JSON.stringify(input.settings[k as keyof WorkspaceSettings]) !== JSON.stringify(ctx.workspace.settings[k as keyof WorkspaceSettings]));
    await ctx.audit({ action: "workspace.settings_updated", category: "workspace", resourceType: "workspace", resourceId: ctx.workspace.id, resourceName: row.name, metadata: { fields: changed.join(", ") || "name" } });
    return toWorkspace(row);
  });
}

export async function updateGrants(grants: Partial<Record<GrantKey, boolean>>) {
  return act(async () => {
    const ctx = await getContext("members.manage");
    if (!grants || typeof grants !== "object" || Array.isArray(grants)) throw new ApiError("VALIDATION", "Invalid permissions.");
    for (const [k, v] of Object.entries(grants))
      if (!CONFIGURABLE_GRANT_KEYS.has(k) || typeof v !== "boolean") throw new ApiError("VALIDATION", "That permission can't be changed.");
    const next = { ...ctx.workspace.grants, ...grants };
    const row = must(await ctx.db.from("workspaces").update({ grants: next }).eq("id", ctx.workspace.id).select("*").single());
    for (const [k, v] of Object.entries(grants)) await ctx.audit({ action: "workspace.grants_updated", category: "workspace", resourceType: "workspace", resourceId: ctx.workspace.id, resourceName: ctx.workspace.name, metadata: { grant: k, enabled: Boolean(v) } });
    return toWorkspace(row);
  });
}

export async function removeWorkspace(confirmName: string) {
  return act(async () => {
    const ctx = await getContext("workspace.delete");
    if (ctx.member.role !== "owner") throw new ApiError("FORBIDDEN", "Only the workspace owner can delete it.");
    if (confirmName.trim() !== ctx.workspace.name) throw new ApiError("VALIDATION", "Type the workspace name exactly to confirm.", { confirm: "The name doesn't match." });
    await ctx.db.from("workspaces").delete().eq("id", ctx.workspace.id);
    (await cookies()).delete(WS_COOKIE);
    return { ok: true };
  });
}

/* ---------------- members ---------------- */

export async function listMembers(params: { search?: string; role?: Role | "all"; status?: Member["status"] | "all" } = {}) {
  return act(async (): Promise<MemberRow[]> => {
    const ctx = await getContext("members.view");
    let q = ctx.db.from("workspace_members").select("*").eq("workspace_id", ctx.workspace.id);
    if (params.role && params.role !== "all") q = q.eq("role", params.role);
    if (params.status && params.status !== "all") q = q.eq("status", params.status);
    const { data } = await q;
    let items = (data ?? []).map((r) => ({ ...toMember(r), isYou: r.user_id === ctx.user.id }));
    const s = params.search?.trim().toLowerCase();
    if (s) items = items.filter((m) => m.name.toLowerCase().includes(s) || m.email.toLowerCase().includes(s));
    const order: Record<Role, number> = { owner: 0, admin: 1, editor: 2, operator: 3, viewer: 4 };
    return items.sort((a, b) => order[a.role] - order[b.role] || (a.name || a.email).localeCompare(b.name || b.email));
  });
}

/** Sends a Supabase invite email to new users; existing users see the invitation when they sign in. */
export async function inviteMembers(input: { emails: string[]; role: Role; message?: string }) {
  return act(async (): Promise<Member[]> => {
    const ctx = await getContext("members.manage");
    const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) throw new ApiError("VALIDATION", "Check the highlighted fields.", { emails: "Enter at least one email address." });
    if (emails.length > 20) throw new ApiError("VALIDATION", "Check the highlighted fields.", { emails: "Invite up to 20 people at a time." });
    await throttle(ctx, `invites:${ctx.workspace.id}`, 50, emails.length);
    const bad = emails.filter((e) => !EMAIL.test(e));
    if (bad.length) throw new ApiError("VALIDATION", "Check the highlighted fields.", { emails: `Not a valid email: ${bad.join(", ")}` });
    if (!assignableRoles(ctx.member.role).includes(input.role)) throw new ApiError("FORBIDDEN", "You can't assign that role.");
    const { data: existing } = await ctx.db.from("workspace_members").select("email").eq("workspace_id", ctx.workspace.id).in("email", emails);
    if (existing?.length) throw new ApiError("CONFLICT", "Check the highlighted fields.", { emails: `Already in this workspace: ${existing.map((m) => m.email).join(", ")}` });
    const { count } = await ctx.db.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).neq("status", "suspended");
    if ((count ?? 0) + emails.length > ctx.workspace.quotas.members) throw new ApiError("CONFLICT", `This workspace allows ${ctx.workspace.quotas.members} members.`);
    const created: Member[] = [];
    for (const email of emails) {
      const { data: profile } = await ctx.db.from("profiles").select("id, name").eq("email", email).maybeSingle();
      const userId = await sendInvitation(ctx, email, profile?.id ?? null, input.role);
      const row = must(await ctx.db.from("workspace_members").insert({ workspace_id: ctx.workspace.id, user_id: userId, email, name: profile?.name ?? "", role: input.role, status: "invited", invited_by: ctx.user.id }).select("*").single());
      created.push(toMember(row));
      await ctx.audit({ action: "member.invited", category: "member", resourceType: "member", resourceId: row.id, resourceName: email, metadata: { role: input.role } });
    }
    // The quota check above can race with a concurrent invite; re-count and undo this batch if it overshot.
    const { count: after } = await ctx.db.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).neq("status", "suspended");
    if ((after ?? 0) > ctx.workspace.quotas.members) {
      await ctx.db.from("workspace_members").delete().eq("workspace_id", ctx.workspace.id).in("id", created.map((m) => m.id));
      throw new ApiError("CONFLICT", `This workspace allows ${ctx.workspace.quotas.members} members.`);
    }
    return created;
  });
}

/**
 * Emails an invitation. New people get a link that creates their account and asks them to set a password;
 * people who already have an account get a link to sign in (the invitation is waiting in Brightrail).
 * Uses Brightrail's Resend key when configured, otherwise Supabase's built-in invite email.
 * Returns the invited person's user id when an account exists or was created.
 */
async function sendInvitation(ctx: Awaited<ReturnType<typeof getContext>>, email: string, existingUserId: string | null, role: Role): Promise<string | null> {
  const db = ctx.db;
  const lines = [`${ctx.user.name} invited you to join “${ctx.workspace.name}” on Brightrail as ${/^[aeiou]/i.test(ROLE_LABELS[role]) ? "an" : "a"} ${ROLE_LABELS[role]}.`];
  if (!authEmailsEnabled()) {
    if (existingUserId) return existingUserId; // they'll see it in the app's workspace switcher
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${env.appUrl}/auth/callback?next=/reset-password?invited=1`, data: { invited_to: ctx.workspace.name, name: "" } });
    if (error && !/already/i.test(error.message)) throw new ApiError("INTERNAL", `Couldn't send the invitation to ${email}: ${error.message}`);
    return data?.user?.id ?? null;
  }
  if (existingUserId) {
    await sendEmail(email, `You're invited to ${ctx.workspace.name} on Brightrail`, [...lines, "Sign in to accept: the invitation is waiting in the workspace menu."], { label: "Sign in to Brightrail", url: `${env.appUrl}/sign-in` }, `invite-${ctx.workspace.id}-${email}-${Math.floor(Date.now() / 60_000)}`);
    return existingUserId;
  }
  let gen = await db.auth.admin.generateLink({ type: "invite", email, options: { data: { invited_to: ctx.workspace.name, name: "" }, redirectTo: `${env.appUrl}/auth/callback?next=/reset-password?invited=1` } });
  let type: "invite" | "magiclink" = "invite";
  if (gen.error && /already|exists|registered/i.test(gen.error.message)) {
    // Invited before but never finished: a one-time sign-in link lands on the same "set your password" page.
    gen = await db.auth.admin.generateLink({ type: "magiclink", email });
    type = "magiclink";
  }
  if (gen.error || !gen.data.properties?.hashed_token) throw new ApiError("INTERNAL", `Couldn't create the invitation for ${email}.`);
  await sendEmail(email, `You're invited to ${ctx.workspace.name} on Brightrail`, [...lines, "Accept to create your account and choose a password. The link works for 24 hours."],
    { label: "Accept invitation", url: callbackLink(gen.data.properties.hashed_token, type, "/reset-password?invited=1") }, `invite-${gen.data.user?.id}-${gen.data.properties.hashed_token.slice(0, 12)}`);
  return gen.data.user?.id ?? null;
}

/**
 * Hourly cap on invitation emails (sent through Brightrail's own email key), counted per key in Postgres (0008).
 * Fails closed in production if the counter is unavailable, open in development.
 */
async function throttle(ctx: Awaited<ReturnType<typeof getContext>>, key: string, maxPerHour: number, count = 1) {
  let hits = 0;
  for (let i = 0; i < count; i++) {
    const { data, error } = await ctx.db.rpc("rate_hit", { p_key: key, p_window_sec: 3600 });
    if (error) {
      console.error("[brightrail] invitation throttle unavailable — run 0008_security_fixes.sql", error.message);
      if (process.env.NODE_ENV === "production") throw new ApiError("NOT_CONFIGURED", "Invitations are temporarily unavailable. Try again later.");
      return;
    }
    hits = typeof data === "number" ? data : 0;
  }
  if (hits > maxPerHour) throw new ApiError("RATE_LIMITED", "Too many invitation emails this hour. Try again later.");
}

async function findMember(ctx: Awaited<ReturnType<typeof getContext>>, id: string) {
  return toMember(must(await ctx.db.from("workspace_members").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Member not found."));
}

export async function changeRole(memberId: string, role: Role) {
  return act(async () => {
    const ctx = await getContext("members.manage");
    const m = await findMember(ctx, memberId);
    if (m.role === "owner") throw new ApiError("FORBIDDEN", "The owner's role can't be changed.");
    if (m.userId === ctx.user.id) throw new ApiError("FORBIDDEN", "You can't change your own role.");
    if (!assignableRoles(ctx.member.role).includes(role) || (ctx.member.role === "admin" && m.role === "admin")) throw new ApiError("FORBIDDEN", "You can't assign that role.");
    const row = must(await ctx.db.from("workspace_members").update({ role }).eq("id", memberId).eq("workspace_id", ctx.workspace.id).select("*").single());
    await ctx.audit({ action: "member.role_changed", category: "member", resourceType: "member", resourceId: memberId, resourceName: m.name || m.email, metadata: { from: m.role, to: role } });
    return toMember(row);
  });
}

/** Usage against the workspace's limits, for Settings → Plan & usage. */
export async function planUsage() {
  return act(async () => {
    const ctx = await getContext("workspace.manage");
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const [runs, members, conns] = await Promise.all([
      ctx.db.from("workflow_runs").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).gte("started_at", monthStart),
      ctx.db.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).neq("status", "suspended"),
      ctx.db.from("connections").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).neq("status", "revoked"),
    ]);
    const resets = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    return {
      plan: ctx.workspace.plan,
      quotas: ctx.workspace.quotas,
      usage: { executions: runs.count ?? 0, members: members.count ?? 0, connections: conns.count ?? 0 },
      resetsAt: resets,
      canChange: ctx.member.role === "owner",
    };
  });
}

/** Owner switches plan; limits change immediately. No payment is taken. */
export async function changePlan(plan: PlanId) {
  return act(async () => {
    const ctx = await getContext("workspace.manage");
    if (ctx.member.role !== "owner") throw new ApiError("FORBIDDEN", "Only the workspace owner can change the plan.");
    const target = PLANS[plan];
    if (!target) throw new ApiError("VALIDATION", "Choose a plan.");
    if (ctx.workspace.plan === plan) return { plan };
    must(await ctx.db.from("workspaces").update({ plan, quotas: target.quotas }).eq("id", ctx.workspace.id).select("id").single());
    await ctx.audit({ action: "workspace.plan_changed", category: "workspace", resourceType: "workspace", resourceId: ctx.workspace.id, resourceName: ctx.workspace.name, metadata: { from: ctx.workspace.plan, to: plan } });
    return { plan };
  });
}

/** Owner hands the workspace to another active member; the previous owner becomes an Admin. */
export async function transferOwnership(memberId: string) {
  return act(async () => {
    const ctx = await getContext("workspace.delete"); // owner-only permission
    if (ctx.member.role !== "owner") throw new ApiError("FORBIDDEN", "Only the owner can transfer ownership.");
    const m = await findMember(ctx, memberId);
    if (m.userId === ctx.user.id) throw new ApiError("CONFLICT", "You already own this workspace.");
    if (m.status !== "active" || !m.userId) throw new ApiError("CONFLICT", "Ownership can only go to an active member who has joined.");
    must(await ctx.db.from("workspace_members").update({ role: "owner" }).eq("id", memberId).eq("workspace_id", ctx.workspace.id).select("id").single());
    must(await ctx.db.from("workspace_members").update({ role: "admin" }).eq("id", ctx.member.id).eq("workspace_id", ctx.workspace.id).select("id").single());
    await ctx.audit({ action: "workspace.ownership_transferred", category: "workspace", resourceType: "workspace", resourceId: ctx.workspace.id, resourceName: ctx.workspace.name, metadata: { from: ctx.user.name, to: m.name || m.email } });
    return { ok: true };
  });
}

export async function setSuspended(memberId: string, suspended: boolean) {
  return act(async () => {
    const ctx = await getContext("members.manage");
    const m = await findMember(ctx, memberId);
    if (m.role === "owner" || m.userId === ctx.user.id) throw new ApiError("FORBIDDEN", "You can't suspend this member.");
    if (ctx.member.role !== "owner" && m.role === "admin") throw new ApiError("FORBIDDEN", "Only the owner can suspend an admin.");
    if (m.status === "invited") throw new ApiError("CONFLICT", "Revoke the invitation instead.");
    const row = must(await ctx.db.from("workspace_members").update({ status: suspended ? "suspended" : "active" }).eq("id", memberId).eq("workspace_id", ctx.workspace.id).select("*").single());
    await ctx.audit({ action: suspended ? "member.suspended" : "member.reactivated", category: "member", resourceType: "member", resourceId: memberId, resourceName: m.name || m.email, metadata: {} });
    return toMember(row);
  });
}

export async function removeMember(memberId: string) {
  return act(async () => {
    const ctx = await getContext("members.manage");
    const m = await findMember(ctx, memberId);
    if (m.role === "owner") throw new ApiError("FORBIDDEN", "The owner can't be removed.");
    if (m.userId === ctx.user.id) throw new ApiError("FORBIDDEN", "You can't remove yourself here.");
    if (ctx.member.role !== "owner" && m.role === "admin") throw new ApiError("FORBIDDEN", "Only the owner can remove an admin.");
    await ctx.db.from("workspace_members").delete().eq("id", memberId).eq("workspace_id", ctx.workspace.id);
    await ctx.audit({ action: m.status === "invited" ? "member.invite_revoked" : "member.removed", category: "member", resourceType: "member", resourceId: memberId, resourceName: m.name || m.email, metadata: { role: m.role } });
    return { ok: true };
  });
}

export async function resendInvite(memberId: string) {
  return act(async () => {
    const ctx = await getContext("members.manage");
    const m = await findMember(ctx, memberId);
    if (m.status !== "invited") throw new ApiError("CONFLICT", "Only pending invitations can be resent.");
    await throttle(ctx, `invite-resend:${m.id}`, 3);
    const { data: profile } = await ctx.db.from("profiles").select("id").eq("email", m.email).maybeSingle();
    await sendInvitation(ctx, m.email, profile?.id ?? null, m.role);
    const row = must(await ctx.db.from("workspace_members").update({ invited_at: ctx.now() }).eq("id", memberId).eq("workspace_id", ctx.workspace.id).select("*").single());
    await ctx.audit({ action: "member.invite_resent", category: "member", resourceType: "member", resourceId: memberId, resourceName: m.email, metadata: {} });
    return toMember(row);
  });
}

/* ---------------- API keys ---------------- */

export async function listApiKeys() {
  return act(async (): Promise<Array<ApiKey & { createdByName: string }>> => {
    const ctx = await getContext("apikeys.manage");
    const { data } = await ctx.db.from("api_keys").select("*").eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false });
    const ids = [...new Set((data ?? []).map((k) => k.created_by))];
    const { data: people } = ids.length ? await ctx.db.from("profiles").select("id, name, email").in("id", ids) : { data: [] };
    return (data ?? []).map((k) => ({ ...toApiKey(k), createdByName: people?.find((p) => p.id === k.created_by)?.name || "Unknown" })).sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1));
  });
}

export async function createApiKey(input: { name: string; scopes: ApiKeyScope[]; expiresInDays: number | null }) {
  return act(async (): Promise<{ key: ApiKey; secret: string }> => {
    const ctx = await getContext("apikeys.manage");
    const errors: Record<string, string> = {};
    if (input.name.trim().length < 3) errors.name = "Use at least 3 characters.";
    if (!Array.isArray(input.scopes) || !input.scopes.length) errors.scopes = "Choose at least one scope.";
    else if (!input.scopes.every((s) => (API_KEY_SCOPES as readonly string[]).includes(s))) errors.scopes = "Choose scopes from the list.";
    if (input.expiresInDays !== null && (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 365)) errors.expiresInDays = "Use between 1 and 365 days, or no expiry.";
    if (Object.keys(errors).length) throw new ApiError("VALIDATION", "Check the highlighted fields.", errors);
    const secret = randomToken("br_live_", 24);
    const row = must(await ctx.db.from("api_keys").insert({
      workspace_id: ctx.workspace.id, name: input.name.trim(), prefix: secret.slice(0, 12), hint: `••••${secret.slice(-4)}`, key_hash: sha256(secret), scopes: input.scopes,
      created_by: ctx.user.id, expires_at: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400_000).toISOString() : null,
    }).select("*").single());
    await ctx.audit({ action: "apikey.created", category: "apikey", resourceType: "api_key", resourceId: row.id, resourceName: row.name, metadata: { scopes: input.scopes.join(",") } });
    return { key: toApiKey(row), secret };
  });
}

export async function revokeApiKey(id: string) {
  return act(async () => {
    const ctx = await getContext("apikeys.manage");
    const row = must(await ctx.db.from("api_keys").update({ status: "revoked" }).eq("id", id).eq("workspace_id", ctx.workspace.id).select("*").single(), "API key not found.");
    await ctx.audit({ action: "apikey.revoked", category: "apikey", resourceType: "api_key", resourceId: id, resourceName: row.name, metadata: {} });
    return toApiKey(row);
  });
}

/* ---------------- audit ---------------- */

export interface AuditParams { search?: string; category?: AuditCategory | "all"; actorId?: string | "all"; from?: string; to?: string; page?: number; pageSize?: number; dir?: "asc" | "desc" }

export async function listAudit(params: AuditParams = {}) {
  return act(async (): Promise<Page<AuditEvent>> => {
    const ctx = await getContext("audit.view");
    const pageSize = params.pageSize ?? 20;
    const page = Math.max(1, params.page ?? 1);
    let q = ctx.db.from("audit_events").select("*", { count: "exact" }).eq("workspace_id", ctx.workspace.id);
    if (params.category && params.category !== "all") q = q.eq("category", params.category);
    if (params.actorId && params.actorId !== "all") q = q.eq("actor->>id", params.actorId);
    if (params.from) q = q.gte("created_at", new Date(`${params.from}T00:00:00`).toISOString());
    if (params.to) q = q.lte("created_at", new Date(`${params.to}T23:59:59`).toISOString());
    const s = params.search?.trim().replace(/[%_,()]/g, "");
    if (s) q = q.or(`action.ilike.%${s}%,resource_name.ilike.%${s}%,actor->>name.ilike.%${s}%`);
    const { data, count } = await q.order("created_at", { ascending: params.dir === "asc" }).range((page - 1) * pageSize, page * pageSize - 1);
    const total = count ?? 0;
    return { items: (data ?? []).map(toAudit), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
  });
}

export async function auditActors() {
  return act(async () => {
    const ctx = await getContext("audit.view");
    const { data } = await ctx.db.from("audit_events").select("actor").eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(1000);
    const map = new Map<string, { id: string; name: string; type: string }>();
    for (const r of data ?? []) map.set(r.actor.id, r.actor);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
}

/* ---------------- dashboard & notifications ---------------- */

export interface DashboardData {
  totals: { workflows: number; active: number; succeeded7d: number; failed7d: number; successRate7d: number | null; prevSucceeded: number; prevFailed: number };
  daily: Array<{ date: string; succeeded: number; failed: number; other: number }>;
  recentRuns: Array<{ id: string; workflowName: string; status: RunStatus; startedAt: string; endedAt?: string; trigger: string }>;
  failures: Array<{ runId: string; workflowName: string; step: string; errorCode: string; at: string; hasApproval: boolean }>;
  pendingApprovals: number;
  activity: AuditEvent[];
  usage: { executions: number; quota: number; members: number; memberQuota: number; connections: number; connectionQuota: number; connectionErrors: number };
  workspace: { name: string; plan: string; timezone: string; role: Role };
  gettingStarted: { createdWorkflow: boolean; connectedIntegration: boolean; published: boolean; ranWorkflow: boolean; invitedTeammate: boolean; firstWorkflowId: string | null };
}

export async function dashboard() {
  return act(async (): Promise<DashboardData> => {
    const ctx = await getContext("runs.view");
    const ws = ctx.workspace.id;
    const since = new Date(Date.now() - 14 * 86400_000).toISOString();
    const [{ data: wfs }, { data: runs }, { data: conns }, { data: members }, { count: pending }, { data: activity }, { data: aps }] = await Promise.all([
      ctx.db.from("workflows").select("id, status, current_version_id, created_at").eq("workspace_id", ws),
      ctx.db.from("workflow_runs").select("id, workflow_name, status, started_at, ended_at, trigger, steps, exception").eq("workspace_id", ws).gte("started_at", since).order("started_at", { ascending: false }).limit(2000),
      ctx.db.from("connections").select("status").eq("workspace_id", ws),
      ctx.db.from("workspace_members").select("status").eq("workspace_id", ws),
      ctx.db.from("approval_requests").select("id", { count: "exact", head: true }).eq("workspace_id", ws).eq("status", "pending"),
      ctx.db.from("audit_events").select("*").eq("workspace_id", ws).order("created_at", { ascending: false }).limit(8),
      ctx.db.from("approval_requests").select("run_id").eq("workspace_id", ws).eq("status", "pending"),
    ]);
    const now = Date.now();
    const age = (r: { started_at: string }) => now - new Date(r.started_at).getTime();
    const R = runs ?? [];
    const s7 = R.filter((r) => age(r) < 7 * 86400_000 && r.status === "succeeded").length;
    const f7 = R.filter((r) => age(r) < 7 * 86400_000 && r.status === "failed").length;
    const prev = (st: string) => R.filter((r) => age(r) >= 7 * 86400_000 && r.status === st).length;
    const today = new Date();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); // same window as the quota check
    const { count: monthCount } = await ctx.db.from("workflow_runs").select("id", { count: "exact", head: true }).eq("workspace_id", ws).gte("started_at", monthStart.toISOString());
    const { count: everRuns } = await ctx.db.from("workflow_runs").select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    const activeConns = (conns ?? []).filter((c) => c.status !== "revoked");
    const firstWf = [...(wfs ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return {
      totals: { workflows: (wfs ?? []).filter((w) => w.status !== "archived").length, active: (wfs ?? []).filter((w) => w.status === "active").length, succeeded7d: s7, failed7d: f7, successRate7d: s7 + f7 ? s7 / (s7 + f7) : null, prevSucceeded: prev("succeeded"), prevFailed: prev("failed") },
      daily: Array.from({ length: 14 }, (_, i) => {
        const key = new Date(now - (13 - i) * 86400_000).toISOString().slice(0, 10);
        const day = R.filter((r) => r.started_at.slice(0, 10) === key);
        return { date: key, succeeded: day.filter((r) => r.status === "succeeded").length, failed: day.filter((r) => r.status === "failed").length, other: day.filter((r) => r.status !== "succeeded" && r.status !== "failed").length };
      }),
      recentRuns: R.slice(0, 8).map((r) => ({ id: r.id, workflowName: r.workflow_name, status: r.status, startedAt: r.started_at, endedAt: r.ended_at ?? undefined, trigger: r.trigger.source })),
      failures: R.filter((r) => r.exception?.status === "open" && (r.status === "failed" || r.status === "waiting_approval")).slice(0, 5).map((r) => {
        const s = (r.steps as Array<{ status: string; nodeLabel: string; errorCode?: string }>).find((x) => x.status === "failed");
        return { runId: r.id, workflowName: r.workflow_name, step: s?.nodeLabel ?? "—", errorCode: s?.errorCode ?? "UNKNOWN", at: r.ended_at ?? r.started_at, hasApproval: (aps ?? []).some((a) => a.run_id === r.id) };
      }),
      pendingApprovals: pending ?? 0,
      // Recent activity comes from the audit log, so it is shown only to roles allowed to see the audit log.
      activity: ctx.can("audit.view") ? (activity ?? []).map(toAudit) : [],
      usage: { executions: monthCount ?? 0, quota: ctx.workspace.quotas.executionsPerMonth, members: (members ?? []).filter((m) => m.status !== "suspended").length, memberQuota: ctx.workspace.quotas.members, connections: activeConns.length, connectionQuota: ctx.workspace.quotas.connections, connectionErrors: activeConns.filter((c) => c.status === "error").length },
      workspace: { name: ctx.workspace.name, plan: ctx.workspace.plan, timezone: ctx.workspace.settings.timezone, role: ctx.member.role },
      gettingStarted: {
        createdWorkflow: (wfs ?? []).length > 0,
        connectedIntegration: activeConns.length > 0,
        published: (wfs ?? []).some((w) => w.current_version_id),
        ranWorkflow: (everRuns ?? 0) > 0,
        invitedTeammate: (members ?? []).length > 1,
        firstWorkflowId: firstWf?.id ?? null,
      },
    };
  });
}

/** Notifications are workspace-wide; read state is per person (notification_reads). */
const memberSince = (m: { joinedAt?: string | null; invitedAt?: string | null }) => m.joinedAt ?? m.invitedAt ?? "1970-01-01T00:00:00Z";

export async function listNotifications() {
  return act(async (): Promise<AppNotification[]> => {
    const ctx = await getContext();
    const { data } = await ctx.db.from("notifications").select("*").eq("workspace_id", ctx.workspace.id).order("created_at", { ascending: false }).limit(20);
    const rows = data ?? [];
    if (!rows.length) return [];
    const { data: reads } = await ctx.db.from("notification_reads").select("notification_id").eq("user_id", ctx.user.id).in("notification_id", rows.map((r) => r.id));
    const readIds = new Set((reads ?? []).map((r) => r.notification_id as string));
    const since = memberSince(ctx.member);
    // Anything from before the person joined counts as read for them.
    return rows.map((r) => ({ ...toNotification(r), read: readIds.has(r.id) || r.created_at < since }));
  });
}

export async function unreadCounts() {
  return act(async () => {
    const ctx = await getContext();
    const [unread, { count: approvals }] = await Promise.all([
      ctx.db.rpc("unread_notification_count", { p_ws: ctx.workspace.id, p_user: ctx.user.id, p_since: memberSince(ctx.member) }),
      ctx.db.from("approval_requests").select("id", { count: "exact", head: true }).eq("workspace_id", ctx.workspace.id).eq("status", "pending"),
    ]);
    if (unread.error) console.error("[brightrail] unread count failed — did you run 0002_live_limits_reads.sql?", unread.error.message);
    return { notifications: typeof unread.data === "number" ? unread.data : 0, approvals: approvals ?? 0 };
  });
}

export async function markNotificationsRead(ids: string[] | "all") {
  return act(async () => {
    const ctx = await getContext();
    if (ids === "all") {
      const { error } = await ctx.db.rpc("mark_all_notifications_read", { p_ws: ctx.workspace.id, p_user: ctx.user.id });
      if (error) throw new ApiError("INTERNAL", "Couldn't mark notifications as read.");
      return { ok: true };
    }
    if (!Array.isArray(ids) || ids.length > 200) throw new ApiError("VALIDATION", "Invalid notification list.");
    // Only ids that belong to this workspace.
    const { data: own } = await ctx.db.from("notifications").select("id").eq("workspace_id", ctx.workspace.id).in("id", ids);
    const rows = (own ?? []).map((n) => ({ notification_id: n.id, user_id: ctx.user.id, workspace_id: ctx.workspace.id }));
    if (rows.length) {
      const { error } = await ctx.db.from("notification_reads").upsert(rows, { onConflict: "notification_id,user_id", ignoreDuplicates: true });
      if (error) throw new ApiError("INTERNAL", "Couldn't mark notifications as read.");
    }
    return { ok: true };
  });
}
