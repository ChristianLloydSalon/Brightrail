import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { userClient } from "@/server/supabase";

/**
 * Landing route for Supabase email links (confirm sign-up, password recovery, invitations) and for
 * Google/GitHub sign-in.
 * Supports the PKCE `code` flow and the `token_hash` flow.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/dashboard";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const sb = await userClient();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const rawType = url.searchParams.get("type");
  const type = (["signup", "email", "invite", "recovery", "magiclink", "email_change"] as const).find((t) => t === rawType) as EmailOtpType | undefined;
  // Google/GitHub sign-in that was cancelled or refused comes back with ?error=…
  if (url.searchParams.get("error")) return NextResponse.redirect(new URL(`/sign-in?error=oauth`, url.origin));
  let ok = false;
  if (code) ok = !(await sb.auth.exchangeCodeForSession(code)).error;
  else if (tokenHash && type) ok = !(await sb.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  const dest = ok ? (type === "invite" ? "/reset-password?invited=1" : type === "recovery" ? "/reset-password" : safeNext) : "/sign-in?error=link";
  return NextResponse.redirect(new URL(dest, url.origin));
}
