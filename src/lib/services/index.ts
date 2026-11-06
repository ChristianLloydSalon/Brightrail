"use client";

import { ApiError, type Result } from "@/lib/api-error";
import type { MeInfo } from "@/server/actions/account";
import { supabaseBrowser } from "@/lib/supabase-browser";
import * as Account from "@/server/actions/account";
import * as Admin from "@/server/actions/admin";
import * as Int from "@/server/actions/integrations";
import * as Runs from "@/server/actions/runs";
import * as Wf from "@/server/actions/workflows";

export { ApiError, errorMessage } from "@/lib/api-error";
export type { Page, SortDir } from "@/lib/api-error";

/** Turns a server-action Result into a resolved value or a thrown ApiError (for React Query). */
async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  let res: Result<T>;
  try {
    res = await p;
  } catch {
    throw new ApiError("NETWORK", "We couldn't reach FlowForge. Check your connection and try again.");
  }
  if (!res.ok) throw new ApiError(res.error.code, res.error.message, res.error.fieldErrors, res.error.requestId);
  return res.data;
}

type Fn = (...args: never[]) => Promise<Result<unknown>>;
type Unwrapped<F> = F extends (...args: infer A) => Promise<Result<infer T>> ? (...args: A) => Promise<T> : never;
function wrap<M extends Record<string, Fn>>(fns: M): { [K in keyof M]: Unwrapped<M[K]> } {
  return Object.fromEntries(Object.entries(fns).map(([k, f]) => [k, (...a: never[]) => unwrap(f(...a))])) as { [K in keyof M]: Unwrapped<M[K]> };
}

function authError(e: { message: string; status?: number } | null, fallback: string): never {
  const msg = e?.message ?? fallback;
  if (/invalid login/i.test(msg)) throw new ApiError("UNAUTHENTICATED", "That email and password don't match an account.");
  if (/email not confirmed/i.test(msg)) throw new ApiError("UNAUTHENTICATED", "Confirm your email address first. Check your inbox for the link we sent.");
  if (/already registered|already been registered/i.test(msg)) throw new ApiError("CONFLICT", "Check the highlighted fields.", { email: "An account with this email already exists. Sign in instead." });
  if (/rate limit/i.test(msg)) throw new ApiError("RATE_LIMITED", "Too many attempts. Wait a minute and try again.");
  // Configuration problems (wrong project URL or key) — point to the setup check instead of a raw gateway message.
  if (/invalid path specified|no api key found|invalid api key|failed to fetch|fetch failed/i.test(msg))
    throw new ApiError("NOT_CONFIGURED", "FlowForge can't reach your Supabase project. Check NEXT_PUBLIC_SUPABASE_URL (just https://<project-ref>.supabase.co) and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env, restart the dev server, and open /setup to verify.");
  throw new ApiError("VALIDATION", msg);
}

const origin = () => (typeof window === "undefined" ? "" : window.location.origin);

/** True when the server sends auth emails through Resend (cached for the page's lifetime). */
let emailMode: Promise<boolean> | null = null;
function viaServerEmail() {
  emailMode ??= Account.authEmailMode().then((r) => (r.ok ? r.data.viaServer : false)).catch(() => false);
  return emailMode;
}

export const authApi = {
  /** Password sign-in. If the person has an authenticator, returns needsCode instead of signing all the way in. */
  async signIn(email: string, password: string): Promise<{ needsCode: true } | ({ needsCode: false } & MeInfo)> {
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) authError(error, "Couldn't sign in.");
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") return { needsCode: true };
    return { needsCode: false, ...(await unwrap(Account.me())) };
  },
  /** Google / GitHub. The browser leaves for the provider and comes back through /auth/callback. */
  async signInWithProvider(provider: "google" | "github", next = "/dashboard") {
    const { error } = await supabaseBrowser().auth.signInWithOAuth({ provider, options: { redirectTo: `${origin()}/auth/callback?next=${encodeURIComponent(next)}` } });
    if (error) authError(error, `Couldn't start ${provider === "google" ? "Google" : "GitHub"} sign-in.`);
  },
  options: () => unwrap(Account.authOptions()),
  /** Returns needsConfirmation when the project requires email confirmation. */
  async signUp(input: { name: string; email: string; password: string }) {
    if (await viaServerEmail()) {
      const r = await unwrap(Account.signUpWithEmail(input));
      if (!r.needsConfirmation) {
        const { error } = await supabaseBrowser().auth.signInWithPassword({ email: input.email.trim(), password: input.password });
        if (error) authError(error, "Account created, but signing in failed. Try signing in.");
      }
      return r;
    }
    const { data, error } = await supabaseBrowser().auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: { data: { name: input.name.trim() }, emailRedirectTo: `${origin()}/auth/callback?next=/onboarding` },
    });
    if (error) authError(error, "Couldn't create the account.");
    // Supabase returns a user with no identities when the email is already registered.
    if (data.user && data.user.identities?.length === 0) authError({ message: "already registered" }, "");
    return { needsConfirmation: !data.session };
  },
  async signOut() {
    await supabaseBrowser().auth.signOut();
  },
  async requestPasswordReset(email: string) {
    if (await viaServerEmail()) return unwrap(Account.requestPasswordResetEmail(email));
    const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${origin()}/auth/callback?next=/reset-password` });
    if (error && /rate limit/i.test(error.message)) authError(error, "");
    // Always succeed so the form can't be used to discover accounts.
    return { sent: true as const };
  },
  async hasRecoverySession() {
    const { data } = await supabaseBrowser().auth.getSession();
    return { email: data.session?.user.email ?? null };
  },
  async resetPassword(password: string) {
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    if (error) authError(error, "Couldn't update the password.");
    return { ok: true as const };
  },
  async changePassword(email: string, current: string, next: string) {
    const sb = supabaseBrowser();
    const { error: e1 } = await sb.auth.signInWithPassword({ email, password: current });
    if (e1) throw new ApiError("VALIDATION", "Check the highlighted fields.", { currentPassword: "Current password is incorrect." });
    const { error } = await sb.auth.updateUser({ password: next });
    if (error) authError(error, "Couldn't change the password.");
    return { ok: true as const };
  },
  ...wrap({ me: Account.me, createWorkspace: Account.createWorkspace, setActiveWorkspace: Account.setActiveWorkspace, acceptInvitation: Account.acceptInvitation, declineInvitation: Account.declineInvitation, updateProfile: Account.updateProfile, updateNotificationPrefs: Account.updateNotificationPrefs, completeOnboarding: Account.completeOnboarding, accountDeletionCheck: Account.accountDeletionCheck, deleteAccount: Account.deleteAccount }),
  setupStatus: Account.setupStatus,
};

export const workflowsApi = wrap({ list: Wf.list, owners: Wf.owners, get: Wf.get, create: Wf.create, updateMeta: Wf.updateMeta, saveDraft: Wf.saveDraft, validate: Wf.validate, publish: Wf.publish, setStatus: Wf.setStatus, runNow: Wf.runNow, sampleInput: Wf.sampleInput });
export const runsApi = wrap({ list: Runs.list, get: Runs.get, retryStep: Runs.retryStep, cancel: Runs.cancel, rerun: Runs.rerun });
export const aiApi = wrap({ analyze: Runs.analyze, requestApproval: Runs.requestApproval, listApprovals: Runs.listApprovals, decide: Runs.decide });
export const integrationsApi = wrap({ list: Int.list, get: Int.get, connections: Int.connections, getConnection: Int.getConnection, testDraft: Int.testDraft, createConnection: Int.createConnection, updateConnection: Int.updateConnection, testConnection: Int.testConnection, rotateConnection: Int.rotateConnection, revokeConnection: Int.revokeConnection });
export const webhooksApi = wrap({ list: Int.listWebhooks, get: Int.getWebhook, create: Int.createWebhook, update: Int.updateWebhook, rotateSecret: Int.rotateWebhookSecret, sendTestEvent: Int.sendTestEvent });
export const planApi = wrap({ usage: Admin.planUsage, change: Admin.changePlan });
export const workspaceApi = wrap({ get: Admin.getWorkspace, update: Admin.updateWorkspace, updateGrants: Admin.updateGrants, remove: Admin.removeWorkspace });
export const membersApi = wrap({ list: Admin.listMembers, invite: Admin.inviteMembers, changeRole: Admin.changeRole, setSuspended: Admin.setSuspended, remove: Admin.removeMember, resendInvite: Admin.resendInvite, transferOwnership: Admin.transferOwnership });
export const apiKeysApi = wrap({ list: Admin.listApiKeys, create: Admin.createApiKey, revoke: Admin.revokeApiKey });
export const auditApi = wrap({ list: Admin.listAudit, actors: Admin.auditActors });
export const dashboardApi = wrap({ get: Admin.dashboard });
export const notificationsApi = wrap({ list: Admin.listNotifications, unread: Admin.unreadCounts, markRead: Admin.markNotificationsRead });

/* ---------------- two-factor (TOTP authenticator apps), via Supabase Auth ---------------- */

export const mfaApi = {
  async status() {
    const { data, error } = await supabaseBrowser().auth.mfa.listFactors();
    if (error) throw new ApiError("INTERNAL", "Couldn't load two-factor settings.");
    const verified = data.totp.find((f) => f.status === "verified");
    return { enabled: !!verified, factorId: verified?.id ?? null, unverified: data.all.filter((f) => f.factor_type === "totp" && f.status !== "verified").map((f) => f.id) };
  },
  /** Starts setup: returns a QR code (SVG data URL) and the text secret for manual entry. */
  async enroll() {
    const sb = supabaseBrowser();
    const { unverified } = await mfaApi.status();
    for (const id of unverified) await sb.auth.mfa.unenroll({ factorId: id }); // clear abandoned attempts
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    if (error) throw new ApiError("VALIDATION", /disabled|not enabled/i.test(error.message) ? "Two-factor isn't switched on for this Supabase project (Authentication → Multi-Factor → TOTP)." : error.message);
    return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
  },
  async verify(factorId: string, code: string) {
    const { error } = await supabaseBrowser().auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    if (error) throw new ApiError("VALIDATION", "That code didn't work. Codes change every 30 seconds — try the current one.", { code: "That code didn't work." });
  },
  /** Second step of sign-in. */
  async verifySignIn(code: string) {
    const { factorId } = await mfaApi.status();
    if (!factorId) throw new ApiError("VALIDATION", "No authenticator is set up for this account.");
    await mfaApi.verify(factorId, code);
  },
  async disable(factorId: string) {
    const { error } = await supabaseBrowser().auth.mfa.unenroll({ factorId });
    if (error) throw new ApiError("VALIDATION", /aal2/i.test(error.message) ? "Sign out and back in with your code, then try again." : error.message);
  },
};
