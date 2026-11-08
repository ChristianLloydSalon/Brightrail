import { can, DEFAULT_GRANTS } from "./permissions";
import type { AppNotification, Role, RoleGrants } from "./types";

/** Per-person notification preferences (stored on profiles.notification_prefs). */
export interface NotificationPrefs {
  runFailures: { inApp: boolean; email: boolean };
  approvals: { inApp: boolean; email: boolean };
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { runFailures: { inApp: true, email: false }, approvals: { inApp: true, email: true } };

/** Fills in defaults and drops anything that isn't a known boolean preference. */
export function normalizePrefs(raw: unknown): NotificationPrefs {
  const r = (raw ?? {}) as Partial<NotificationPrefs>;
  const pick = (k: keyof NotificationPrefs) => ({
    inApp: typeof r[k]?.inApp === "boolean" ? r[k]!.inApp : DEFAULT_NOTIFICATION_PREFS[k].inApp,
    email: typeof r[k]?.email === "boolean" ? r[k]!.email : DEFAULT_NOTIFICATION_PREFS[k].email,
  });
  return { runFailures: pick("runFailures"), approvals: pick("approvals") };
}

/** Which preference governs each notification kind (kinds without one are never emailed). */
export const PREF_FOR: Partial<Record<AppNotification["kind"], keyof NotificationPrefs>> = { run_failed: "runFailures", approval_requested: "approvals" };

/** Who may receive a notification of this kind at all (same rule for in-app toasts and email). */
export function allowedFor(kind: AppNotification["kind"], role: Role, grants: RoleGrants): boolean {
  if (kind === "approval_requested") return can(role, "approvals.decide", { ...DEFAULT_GRANTS, ...grants });
  return can(role, "runs.view", { ...DEFAULT_GRANTS, ...grants });
}
