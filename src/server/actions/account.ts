"use server";

import { cookies } from "next/headers";
import { authEmailsEnabled, callbackLink, sendEmail, throttleAuthEmail } from "../auth-emails";
import { validateEmail, validateNewPassword } from "@/lib/validators";
import { PLANS } from "@/lib/domain/plans";
import { env } from "../env";
import { normalizePrefs, type NotificationPrefs } from "../notifications";
import { ApiError } from "@/lib/api-error";
import { DEFAULT_GRANTS } from "@/lib/domain/permissions";
import type { Role, Workspace } from "@/lib/domain/types";
import { slugify } from "@/lib/utils";
import { act, dbError, getSessionUser, WS_COOKIE } from "../context";
import { missingConfig } from "../env";
import { DEFAULT_SETTINGS, toWorkspace } from "../rows";
import { adminClient } from "../supabase";

export interface MeInfo {
  user: { id: string; email: string; name: string; title?: string; onboardingCompletedAt: string | null; notificationPrefs: NotificationPrefs };
  /** Whether FlowForge can send notification emails (RESEND_API_KEY + EMAIL_FROM set). */
  emailNotificationsAvailable: boolean;
  workspaces: Array<Workspace & { role: Role }>;
  activeWorkspaceId: string | null;
  invitations: Array<{ memberId: string; workspaceId: string; workspaceName: string; role: Role; invitedByName: string }>;
}

let providerCache: { at: number; value: { google: boolean; github: boolean } } | null = null;

/** Which social sign-ins are switched on in Supabase (public; shown on the sign-in page). */
export async function authOptions() {
  return act(async () => {
    if (providerCache && Date.now() - providerCache.at < 60_000) return providerCache.value;
    let value = { google: false, github: false };
    try {
      if (env.supabaseUrl && env.supabaseAnonKey) {
        const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseAnonKey }, signal: AbortSignal.timeout(5000) });
        const j = (await res.json()) as { external?: Record<string, boolean> };
        value = { google: !!j.external?.google, github: !!j.external?.github };
      }
    } catch {
      /* fall back to email/password only */
    }
    providerCache = { at: Date.now(), value };
    return value;
  });
}

export async function setupStatus() {
  return { missing: missingConfig() };
}

export async function me() {
  return act(async (): Promise<MeInfo> => {
    const user = await getSessionUser();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
    const { data: rows } = await db.from("workspace_members").select("*, workspaces(*)").eq("user_id", user.id);
    const active = (rows ?? []).filter((r) => r.status === "active" && r.workspaces);
    const pending = (rows ?? []).filter((r) => r.status === "invited" && r.workspaces);
    const inviterIds = pending.map((r) => r.invited_by).filter(Boolean);
    const { data: inviters } = inviterIds.length ? await db.from("profiles").select("id, name, email").in("id", inviterIds) : { data: [] };
    const preferred = (await cookies()).get(WS_COOKIE)?.value ?? null;
    const workspaces = active.map((r) => ({ ...toWorkspace(r.workspaces), role: r.role as Role }));
    return {
      user: { id: user.id, email: user.email, name: user.name, title: profile?.title ?? undefined, onboardingCompletedAt: profile?.onboarding_completed_at ?? null, notificationPrefs: normalizePrefs(profile?.notification_prefs) },
      emailNotificationsAvailable: !!(env.resendApiKey && env.emailFrom),
      workspaces,
      activeWorkspaceId: workspaces.find((w) => w.id === preferred)?.id ?? workspaces[0]?.id ?? null,
      invitations: pending.map((r) => {
        const inv = (inviters ?? []).find((p) => p.id === r.invited_by);
        return { memberId: r.id, workspaceId: r.workspace_id, workspaceName: r.workspaces.name, role: r.role, invitedByName: inv?.name || inv?.email || "A teammate" };
      }),
    };
  });
}

async function setWorkspaceCookie(id: string) {
  (await cookies()).set(WS_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function setActiveWorkspace(workspaceId: string) {
  return act(async () => {
    const user = await getSessionUser();
    const { data } = await adminClient().from("workspace_members").select("id").eq("user_id", user.id).eq("workspace_id", workspaceId).eq("status", "active").maybeSingle();
    if (!data) throw new ApiError("FORBIDDEN", "You're not a member of that workspace.");
    await setWorkspaceCookie(workspaceId);
    return { ok: true };
  });
}

export async function createWorkspace(name: string, timezone?: string) {
  return act(async (): Promise<Workspace> => {
    const user = await getSessionUser();
    const db = adminClient();
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) throw new ApiError("VALIDATION", "Check the highlighted fields.", { name: "Use 2 to 80 characters." });
    let slug = slugify(trimmed).replace(/^-+|-+$/g, "");
    if (slug.length < 3) slug = `${slug || "team"}-workspace`;
    slug = slug.slice(0, 40).replace(/-+$/, ""); // DB allows 3–48 chars
    const { data: taken, error: lookupErr } = await db.from("workspaces").select("id").eq("slug", slug).maybeSingle();
    if (lookupErr) throw dbError(lookupErr, "create the workspace");
    if (taken) slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
    const { data: ws, error } = await db
      .from("workspaces")
      .insert({ name: trimmed, slug, created_by: user.id, plan: "free", quotas: PLANS.free.quotas, settings: { ...DEFAULT_SETTINGS, timezone: timezone || "UTC" }, grants: DEFAULT_GRANTS })
      .select("*")
      .single();
    if (error || !ws) throw dbError(error ?? { message: "no row returned" }, "create the workspace");
    const now = new Date().toISOString();
    const { error: memberErr } = await db.from("workspace_members").insert({ workspace_id: ws.id, user_id: user.id, email: user.email, name: user.name, role: "owner", status: "active", joined_at: now, last_active_at: now });
    if (memberErr) {
      await db.from("workspaces").delete().eq("id", ws.id); // don't leave a workspace nobody owns
      throw dbError(memberErr, "create the workspace");
    }
    await db.from("audit_events").insert({ workspace_id: ws.id, actor: { type: "user", id: user.id, name: user.name }, action: "workspace.created", category: "workspace", resource_type: "workspace", resource_id: ws.id, resource_name: ws.name, metadata: {} });
    await setWorkspaceCookie(ws.id);
    return toWorkspace(ws);
  });
}

export async function acceptInvitation(memberId: string) {
  return act(async () => {
    const user = await getSessionUser();
    const db = adminClient();
    const { data: m } = await db.from("workspace_members").select("*, workspaces(name)").eq("id", memberId).eq("user_id", user.id).eq("status", "invited").maybeSingle();
    if (!m) throw new ApiError("NOT_FOUND", "This invitation is no longer available.");
    const now = new Date().toISOString();
    await db.from("workspace_members").update({ status: "active", joined_at: now, last_active_at: now, name: user.name }).eq("id", memberId);
    await db.from("audit_events").insert({ workspace_id: m.workspace_id, actor: { type: "user", id: user.id, name: user.name }, action: "member.joined", category: "member", resource_type: "member", resource_id: memberId, resource_name: user.email, metadata: { role: m.role } });
    await setWorkspaceCookie(m.workspace_id);
    return { workspaceId: m.workspace_id as string, workspaceName: m.workspaces?.name as string };
  });
}

export async function declineInvitation(memberId: string) {
  return act(async () => {
    const user = await getSessionUser();
    await adminClient().from("workspace_members").delete().eq("id", memberId).eq("user_id", user.id).eq("status", "invited");
    return { ok: true };
  });
}

export async function updateProfile(input: { name: string; title?: string }) {
  return act(async () => {
    const user = await getSessionUser();
    if (input.name.trim().length < 2) throw new ApiError("VALIDATION", "Check the highlighted fields.", { name: "Enter your full name." });
    const db = adminClient();
    await db.from("profiles").update({ name: input.name.trim(), title: input.title?.trim() || null }).eq("id", user.id);
    await db.from("workspace_members").update({ name: input.name.trim() }).eq("user_id", user.id);
    return { ok: true };
  });
}

export async function updateNotificationPrefs(prefs: NotificationPrefs) {
  return act(async () => {
    const user = await getSessionUser();
    const clean = normalizePrefs(prefs);
    const { error } = await adminClient().from("profiles").update({ notification_prefs: clean }).eq("id", user.id);
    if (error) throw dbError(error, "save your notification preferences");
    return clean;
  });
}

export async function completeOnboarding() {
  return act(async () => {
    const user = await getSessionUser();
    await adminClient().from("profiles").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", user.id);
    return { ok: true };
  });
}

/** What deleting the account would do: workspaces that block it, and solo workspaces that would be deleted. */
export async function accountDeletionCheck() {
  return act(async () => {
    const user = await getSessionUser();
    const db = adminClient();
    const { data: mine } = await db.from("workspace_members").select("workspace_id, role, workspaces(name)").eq("user_id", user.id).eq("status", "active");
    const blocking: Array<{ id: string; name: string }> = [];
    const deleting: Array<{ id: string; name: string }> = [];
    for (const m of mine ?? []) {
      if (m.role !== "owner") continue;
      const { count } = await db.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", m.workspace_id).neq("user_id", user.id).in("status", ["active", "suspended", "invited"]);
      const w = { id: m.workspace_id as string, name: (m.workspaces as unknown as { name: string } | null)?.name ?? "Workspace" };
      if ((count ?? 0) > 0) blocking.push(w);
      else deleting.push(w);
    }
    return { email: user.email, blocking, deleting };
  });
}

/**
 * Permanently deletes the signed-in person's account. Blocked while they own a workspace with other
 * members (transfer ownership first). Workspaces where they're the only member are deleted; in the rest,
 * their workflows move to the workspace owner and API keys they created are revoked.
 */
export async function deleteAccount(confirmEmail: string) {
  return act(async () => {
    const user = await getSessionUser();
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) throw new ApiError("VALIDATION", "Check the highlighted fields.", { confirm: "Type your email address exactly." });
    const check = await accountDeletionCheck();
    if (!check.ok) throw new ApiError(check.error.code, check.error.message);
    if (check.data.blocking.length) throw new ApiError("CONFLICT", `Transfer ownership of ${check.data.blocking.map((w) => `“${w.name}”`).join(", ")} first (Settings → Members), or remove the other members.`);
    const db = adminClient();
    const solo = new Set(check.data.deleting.map((w) => w.id));
    const { data: memberships } = await db.from("workspace_members").select("id, workspace_id").eq("user_id", user.id);
    for (const m of memberships ?? []) {
      if (solo.has(m.workspace_id)) continue;
      const { data: owner } = await db.from("workspace_members").select("user_id").eq("workspace_id", m.workspace_id).eq("role", "owner").eq("status", "active").maybeSingle();
      if (owner?.user_id) await db.from("workflows").update({ owner_id: owner.user_id }).eq("workspace_id", m.workspace_id).eq("owner_id", user.id);
      await db.from("api_keys").update({ status: "revoked" }).eq("workspace_id", m.workspace_id).eq("created_by", user.id).eq("status", "active");
      await db.from("audit_events").insert({ workspace_id: m.workspace_id, actor: { type: "user", id: user.id, name: user.name }, action: "member.account_deleted", category: "member", resource_type: "member", resource_id: m.id, resource_name: user.email, metadata: { workflowsReassigned: true, apiKeysRevoked: true } });
    }
    // Delete the user first: if that fails, their solo workspaces are still intact.
    const { error } = await db.auth.admin.deleteUser(user.id);
    if (error) {
      console.error("[flowforge] deleteUser failed", error.message);
      if (/database error/i.test(error.message)) throw new ApiError("NOT_CONFIGURED", "Couldn't delete your account: the database still links records to it. Run supabase/migrations/0006_accounts_webhooks_plans.sql, then try again.");
      throw dbError({ code: (error as { code?: string }).code, message: error.message }, "delete your account");
    }
    for (const id of solo) await db.from("workspaces").delete().eq("id", id);
    (await cookies()).delete(WS_COOKIE);
    return { ok: true };
  });
}

/* ---------------- auth emails through FlowForge's Resend key ---------------- */

/** Whether the browser should use the server-side sign-up/reset below (true when Resend is configured). */
export async function authEmailMode() {
  return act(async () => ({ viaServer: authEmailsEnabled() }));
}

/**
 * Sign-up with the confirmation email sent through Resend. The response is the same whether or not the
 * email already has an account, so the form can't be used to discover who uses FlowForge; an existing
 * person gets a "you already have an account" email instead.
 */
export async function signUpWithEmail(input: { name: string; email: string; password: string }) {
  return act(async () => {
    if (!authEmailsEnabled()) throw new ApiError("NOT_CONFIGURED", "Email sending isn't configured on the server.");
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const errors: Record<string, string> = {};
    if (name.length < 2) errors.name = "Enter your name.";
    const emailErr = validateEmail(email);
    const pwErr = validateNewPassword(input.password);
    if (emailErr) errors.email = emailErr;
    if (pwErr) errors.password = pwErr;
    if (Object.keys(errors).length) throw new ApiError("VALIDATION", "Check the highlighted fields.", errors);
    await throttleAuthEmail("signup", email);

    const db = adminClient();
    const { data, error } = await db.auth.admin.generateLink({ type: "signup", email, password: input.password, options: { data: { name }, redirectTo: `${env.appUrl}/auth/callback?next=/onboarding` } });
    if (error) {
      if (/already|exists|registered/i.test(error.message)) {
        const { data: rec } = await db.auth.admin.generateLink({ type: "recovery", email });
        await sendEmail(email, "You already have a FlowForge account", ["Someone (hopefully you) tried to create a FlowForge account with this email address, but you already have one.", "Sign in as usual, or use the button below to choose a new password."],
          { label: "Reset my password", url: rec?.properties?.hashed_token ? callbackLink(rec.properties.hashed_token, "recovery") : `${env.appUrl}/forgot-password` }, `exists-${email}-${Math.floor(Date.now() / 600_000)}`);
        return { needsConfirmation: true };
      }
      console.error("[flowforge] generateLink(signup) failed", error.message);
      throw new ApiError("INTERNAL", "Couldn't create the account. Try again in a minute.");
    }
    // Projects with "Confirm email" turned off confirm immediately; the browser then signs in.
    if (data.user?.email_confirmed_at) return { needsConfirmation: false };
    await sendEmail(email, "Confirm your FlowForge account", [`Hi ${name.split(" ")[0]},`, "Confirm your email address to finish creating your FlowForge account. The link works for one hour."],
      { label: "Confirm my email", url: callbackLink(data.properties.hashed_token, "signup", "/onboarding") }, `signup-${data.user?.id}-${data.properties.hashed_token.slice(0, 12)}`);
    return { needsConfirmation: true };
  });
}

/** Password reset through Resend. Always reports success so it can't reveal which emails have accounts. */
export async function requestPasswordResetEmail(emailInput: string) {
  return act(async () => {
    if (!authEmailsEnabled()) throw new ApiError("NOT_CONFIGURED", "Email sending isn't configured on the server.");
    const email = emailInput.trim().toLowerCase();
    const emailErr = validateEmail(email);
    if (emailErr) throw new ApiError("VALIDATION", "Check the highlighted fields.", { email: emailErr });
    await throttleAuthEmail("recovery", email);
    const { data, error } = await adminClient().auth.admin.generateLink({ type: "recovery", email });
    if (!error && data.properties?.hashed_token) {
      await sendEmail(email, "Reset your FlowForge password", ["We received a request to reset the password for your FlowForge account.", "Use the button below to choose a new one. The link works for one hour and can be used once."],
        { label: "Choose a new password", url: callbackLink(data.properties.hashed_token, "recovery") }, `recovery-${data.user?.id}-${data.properties.hashed_token.slice(0, 12)}`);
    }
    return { sent: true as const };
  });
}
