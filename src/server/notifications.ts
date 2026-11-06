import "server-only";
import { can, DEFAULT_GRANTS } from "@/lib/domain/permissions";
import type { AppNotification, Role, RoleGrants } from "@/lib/domain/types";
import { inngest } from "./engine/client";
import { env } from "./env";
import { adminClient } from "./supabase";

/** Per-person notification preferences (stored on profiles.notification_prefs). */
export interface NotificationPrefs {
  runFailures: { inApp: boolean; email: boolean };
  approvals: { inApp: boolean; email: boolean };
}
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { runFailures: { inApp: true, email: false }, approvals: { inApp: true, email: true } };

export function normalizePrefs(raw: unknown): NotificationPrefs {
  const r = (raw ?? {}) as Partial<NotificationPrefs>;
  const pick = (k: keyof NotificationPrefs) => ({
    inApp: typeof r[k]?.inApp === "boolean" ? r[k]!.inApp : DEFAULT_NOTIFICATION_PREFS[k].inApp,
    email: typeof r[k]?.email === "boolean" ? r[k]!.email : DEFAULT_NOTIFICATION_PREFS[k].email,
  });
  return { runFailures: pick("runFailures"), approvals: pick("approvals") };
}

const PREF_FOR: Partial<Record<AppNotification["kind"], keyof NotificationPrefs>> = { run_failed: "runFailures", approval_requested: "approvals" };

/** Who may receive a notification of this kind at all (same rule for in-app toasts and email). */
export function allowedFor(kind: AppNotification["kind"], role: Role, grants: RoleGrants): boolean {
  if (kind === "approval_requested") return can(role, "approvals.decide", { ...DEFAULT_GRANTS, ...grants });
  return can(role, "runs.view", { ...DEFAULT_GRANTS, ...grants });
}

export const NOTIFICATION_CREATED = "notification/created";

/** Inserts the in-app notification and queues the email fan-out (never blocks or fails the caller). */
export async function createNotification(n: { workspaceId: string; kind: AppNotification["kind"]; title: string; body: string; href: string }) {
  const { data, error } = await adminClient().from("notifications").insert({ workspace_id: n.workspaceId, kind: n.kind, title: n.title, body: n.body, href: n.href }).select("id").single();
  if (error || !data) {
    console.error("[flowforge] couldn't create notification", error?.message);
    return;
  }
  if (!env.resendApiKey || !env.emailFrom) return;
  try {
    await inngest.send({ id: `notif-${data.id}`, name: NOTIFICATION_CREATED, data: { notificationId: data.id } });
  } catch (e) {
    console.error("[flowforge] couldn't queue notification email", (e as Error).message);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Emails each opted-in, permitted, active member. One Inngest step per recipient so retries never double-send. */
export const notificationEmailFunction = inngest.createFunction(
  { id: "notification-email", name: "Email notifications", retries: 3, triggers: [{ event: NOTIFICATION_CREATED }] },
  async ({ event, step }) => {
    const { notificationId } = event.data as { notificationId: string };
    const plan = await step.run("recipients", async () => {
      const db = adminClient();
      const { data: n } = await db.from("notifications").select("*").eq("id", notificationId).maybeSingle();
      if (!n) return null;
      const pref = PREF_FOR[n.kind as AppNotification["kind"]];
      if (!pref) return null;
      const { data: ws } = await db.from("workspaces").select("name, grants").eq("id", n.workspace_id).single();
      const { data: members } = await db.from("workspace_members").select("user_id, email, role").eq("workspace_id", n.workspace_id).eq("status", "active").not("user_id", "is", null);
      const ids = (members ?? []).map((m) => m.user_id as string);
      const { data: profiles } = ids.length ? await db.from("profiles").select("id, notification_prefs").in("id", ids) : { data: [] };
      const prefsById = new Map((profiles ?? []).map((p) => [p.id as string, normalizePrefs(p.notification_prefs)]));
      const to = (members ?? [])
        .filter((m) => allowedFor(n.kind, m.role as Role, (ws?.grants ?? {}) as RoleGrants))
        .filter((m) => (prefsById.get(m.user_id) ?? DEFAULT_NOTIFICATION_PREFS)[pref].email)
        .map((m) => ({ userId: m.user_id as string, email: m.email as string }));
      return { title: n.title as string, body: n.body as string, url: `${env.appUrl}${n.href}`, workspace: (ws?.name as string) ?? "FlowForge", to };
    });
    if (!plan) return { sent: 0 };
    let sent = 0;
    for (const r of plan.to) {
      await step.run(`email-${r.userId}`, async () => {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": `notif-${notificationId}-${r.userId}` },
          body: JSON.stringify({
            from: env.emailFrom,
            to: [r.email],
            subject: `[${plan.workspace}] ${plan.title}`,
            text: `${plan.title}\n${plan.body}\n\nOpen in FlowForge: ${plan.url}\n\nYou can change which emails you get under Profile → Notifications.`,
            html: `<p><strong>${esc(plan.title)}</strong><br>${esc(plan.body)}</p><p><a href="${esc(plan.url)}">Open in FlowForge</a></p><p style="color:#666;font-size:12px">You can change which emails you get under Profile → Notifications.</p>`,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
      });
      sent++;
    }
    return { sent };
  },
);
