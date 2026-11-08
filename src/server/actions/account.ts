"use server";

import type { NotificationPrefs } from "@/lib/domain/notification-prefs";
import { container } from "../container";
import { missingConfig, env } from "../infrastructure/config/env";
import { act, asUser } from "../presentation/action";

export type { MeInfo } from "../application/account/account-service";

/** Which social sign-ins are switched on in Supabase (public; shown on the sign-in page). */
export async function authOptions() {
  return act(() => container().authProviders.enabled());
}

/** Missing configuration. Open to anyone only on a fresh install; once Supabase is set up, sign-in is required. */
export async function setupStatus() {
  if (env.supabaseUrl && env.supabaseAnonKey) {
    try {
      await container().session.user();
    } catch {
      return { missing: [] as string[] };
    }
  }
  return { missing: missingConfig() };
}

export async function me() {
  return asUser((app, user) => app.account.me(user));
}

export async function setActiveWorkspace(workspaceId: string) {
  return asUser((app, user) => app.account.setActiveWorkspace(user, workspaceId));
}

export async function createWorkspace(name: string, timezone?: string) {
  return asUser((app, user) => app.account.createWorkspace(user, name, timezone));
}

export async function acceptInvitation(memberId: string) {
  return asUser((app, user) => app.account.acceptInvitation(user, memberId));
}

export async function declineInvitation(memberId: string) {
  return asUser((app, user) => app.account.declineInvitation(user, memberId));
}

export async function updateProfile(input: { name: string; title?: string }) {
  return asUser((app, user) => app.account.updateProfile(user, input));
}

export async function updateNotificationPrefs(prefs: NotificationPrefs) {
  return asUser((app, user) => app.account.updateNotificationPrefs(user, prefs));
}

export async function completeOnboarding() {
  return asUser((app, user) => app.account.completeOnboarding(user));
}

/** What deleting the account would do: workspaces that block it, and solo workspaces that would be deleted. */
export async function accountDeletionCheck() {
  return asUser((app, user) => app.account.deletionCheck(user));
}

/** Permanently deletes the signed-in person's account (see AccountService.deleteAccount). */
export async function deleteAccount(confirmEmail: string) {
  return asUser((app, user) => app.account.deleteAccount(user, confirmEmail));
}

/* ---------------- auth emails through Brightrail's Resend key ---------------- */

/** Whether the browser should use the server-side sign-up/reset below (true when Resend is configured). */
export async function authEmailMode() {
  return act(async () => ({ viaServer: container().authEmails.viaServer }));
}

/** Sign-up with the confirmation email sent through Resend; never reveals whether the email has an account. */
export async function signUpWithEmail(input: { name: string; email: string; password: string }) {
  return act(() => container().authEmails.signUp(input));
}

/** Password reset through Resend. Always reports success so it can't reveal which emails have accounts. */
export async function requestPasswordResetEmail(emailInput: string) {
  return act(() => container().authEmails.requestPasswordReset(emailInput));
}
