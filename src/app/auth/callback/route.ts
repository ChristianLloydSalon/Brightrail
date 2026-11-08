import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { LINK_COOKIE, linkMatchesBrowser } from "@/server/auth-emails";
import { completeEmailLink, destinationAfterLink, emailLinkType } from "@/server/auth-links";
import { userClient } from "@/server/supabase";

/**
 * Landing route for Supabase email links (confirm sign-up, password recovery, invitations) and for
 * Google/GitHub sign-in.
 * Supports the PKCE `code` flow and the `token_hash` flow.
 *
 * The PKCE flow is already bound to the browser that started it (the code verifier cookie). A token_hash
 * link isn't, so it is completed here only when it carries a binding matching this browser's cookie;
 * otherwise the person confirms on /auth/confirm first. That stops someone from sending a link to their
 * own account and silently signing the victim into it.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next");
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = emailLinkType(url.searchParams.get("type"));
  // Google/GitHub sign-in that was cancelled or refused comes back with ?error=…
  if (url.searchParams.get("error")) return NextResponse.redirect(new URL(`/sign-in?error=oauth`, url.origin));
  let ok = false;
  if (code) {
    const sb = await userClient();
    ok = !(await sb.auth.exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    const jar = await cookies();
    if (!linkMatchesBrowser(url.searchParams.get("b"), jar.get(LINK_COOKIE)?.value)) {
      const confirm = new URL("/auth/confirm", url.origin);
      confirm.searchParams.set("token_hash", tokenHash);
      confirm.searchParams.set("type", type);
      if (next) confirm.searchParams.set("next", next);
      return NextResponse.redirect(confirm);
    }
    ok = await completeEmailLink(tokenHash, type);
    if (ok) jar.delete({ name: LINK_COOKIE, path: "/auth" });
  }
  return NextResponse.redirect(new URL(destinationAfterLink(ok, type, next), url.origin));
}

/** The confirmation button on /auth/confirm. Accepted only from this site (Origin / Sec-Fetch-Site). */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if ((origin && origin !== url.origin) || (!origin && site !== "same-origin")) {
    return NextResponse.redirect(new URL("/sign-in?error=link", url.origin), 303);
  }
  const form = await req.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = emailLinkType(String(form.get("type") ?? ""));
  const next = String(form.get("next") ?? "") || null;
  const ok = !!tokenHash && !!type && (await completeEmailLink(tokenHash, type));
  return NextResponse.redirect(new URL(destinationAfterLink(ok, type, next), url.origin), 303);
}
