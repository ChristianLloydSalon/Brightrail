import "server-only";
import { headers } from "next/headers";
import { ApiError } from "@/lib/api-error";
import { env } from "./env";
import { adminClient } from "./supabase";

/**
 * Sign-up confirmations, password resets and invitations sent through FlowForge's own Resend key
 * (RESEND_API_KEY + EMAIL_FROM) instead of Supabase's built-in sender, which only allows a few
 * emails an hour. Links are created with Supabase's admin generateLink and land on /auth/callback.
 * When no key is set, the app keeps using Supabase's emails.
 */
export const authEmailsEnabled = () => !!(env.resendApiKey && env.emailFrom);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function callbackLink(tokenHash: string, type: "signup" | "recovery" | "invite" | "magiclink", next?: string) {
  const u = new URL("/auth/callback", env.appUrl);
  u.searchParams.set("token_hash", tokenHash);
  u.searchParams.set("type", type);
  if (next) u.searchParams.set("next", next);
  return u.toString();
}

/** One email; the idempotency key stops a retried request from sending twice. */
export async function sendEmail(to: string, subject: string, lines: string[], button: { label: string; url: string }, idempotencyKey: string) {
  const text = `${lines.join("\n\n")}\n\n${button.label}: ${button.url}\n\nIf you didn't expect this email, you can ignore it.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;line-height:1.5;color:#1c1917">
${lines.map((l) => `<p>${esc(l)}</p>`).join("\n")}
<p><a href="${esc(button.url)}" style="display:inline-block;background:#c2410c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${esc(button.label)}</a></p>
<p style="color:#78716c;font-size:13px">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(button.url)}</span></p>
<p style="color:#78716c;font-size:13px">If you didn't expect this email, you can ignore it.</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from: env.emailFrom, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.error("[flowforge] Resend rejected an auth email", res.status, (await res.text()).slice(0, 300));
    throw new ApiError("INTERNAL", "We couldn't send the email right now. Try again in a minute.");
  }
}

/**
 * Per-email and per-IP limits on auth emails, so these forms can't be used to flood an inbox or
 * burn the Resend quota. Counted atomically in Postgres (0007). Fails open if the table is missing.
 */
export async function throttleAuthEmail(kind: string, email: string) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
  const db = adminClient();
  const check = async (key: string, max: number) => {
    const { data, error } = await db.rpc("auth_email_hit", { p_key: key });
    if (error) {
      console.error("[flowforge] auth email throttle unavailable — run 0007_auth_emails.sql", error.message);
      return;
    }
    if (typeof data === "number" && data > max) throw new ApiError("RATE_LIMITED", "Too many emails requested. Wait a bit and try again.");
  };
  await check(`${kind}:${email.toLowerCase()}`, 3);
  await check(`ip:${ip}`, 20);
}
