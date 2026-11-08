import "server-only";
import type { EmailPlan } from "@/server/application/notifications/notification-service";
import { env } from "../config/env";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** One notification email through Resend; the idempotency key makes a retried step a no-op. */
export async function sendNotificationEmail(plan: EmailPlan, to: { email: string }, idempotencyKey: string): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      from: env.emailFrom,
      to: [to.email],
      subject: `[${plan.workspace}] ${plan.title}`,
      text: `${plan.title}\n${plan.body}\n\nOpen in Brightrail: ${plan.url}\n\nYou can change which emails you get under Profile → Notifications.`,
      html: `<p><strong>${esc(plan.title)}</strong><br>${esc(plan.body)}</p><p><a href="${esc(plan.url)}">Open in Brightrail</a></p><p style="color:#666;font-size:12px">You can change which emails you get under Profile → Notifications.</p>`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
