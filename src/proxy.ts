import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseUrl } from "@/lib/supabase-url";

// /setup is public only while Supabase isn't configured (handled below); afterwards it needs sign-in,
// because it reports which settings and migrations exist.
// "/" is the public home page, shown to everyone.
const PUBLIC = ["/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/auth", "/api/inngest", "/api/v1", "/privacy", "/terms"];
const MFA_PAGE = "/mfa";

/**
 * Strict Content-Security-Policy: scripts run only if they carry this request's nonce (Next.js adds it to
 * its own scripts automatically; see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * Styles allow inline attributes because the workflow canvas positions nodes with style="…".
 */
function contentSecurityPolicy(nonce: string, supabase: string | null) {
  const dev = process.env.NODE_ENV === "development";
  const sb = supabase ? ` ${supabase} ${supabase.replace(/^http/, "ws")}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${sb}${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Refreshes the Supabase session cookie on every request and sends signed-out visitors to sign-in.
 * Authorization is still enforced per request in the server actions.
 */
export async function proxy(request: NextRequest) {
  const url = supabaseUrl();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const path = request.nextUrl.pathname;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce, url || null);
  /** Continues the request with the nonce/CSP visible to rendering (and any refreshed auth cookies). */
  const next = () => {
    const headers = new Headers(request.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("Content-Security-Policy", csp);
    return res;
  };
  if (!url || !key) return path.startsWith("/setup") || path.startsWith("/api") ? next() : NextResponse.redirect(new URL("/setup", request.url));

  let response = next();
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = next();
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await sb.auth.getUser();
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));
  if (!data.user && !isPublic) {
    const to = new URL("/sign-in", request.url);
    to.searchParams.set("next", path);
    return NextResponse.redirect(to);
  }
  if (data.user && !isPublic) {
    // Signed in with a password/social login but has an authenticator: ask for the code first.
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    const needsCode = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2";
    if (needsCode && path !== MFA_PAGE) {
      if (request.method !== "GET") return NextResponse.json({ code: "UNAUTHENTICATED", message: "Enter your two-factor code first." }, { status: 401 });
      const to = new URL(MFA_PAGE, request.url);
      to.searchParams.set("next", path);
      return NextResponse.redirect(to);
    }
    if (!needsCode && path === MFA_PAGE) return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (data.user && (path === "/sign-in" || path === "/sign-up")) return NextResponse.redirect(new URL("/dashboard", request.url));
  return response;
}

export const config = {
  // Metadata files (robots, sitemap, manifest, icons, share images) must stay reachable without signing in.
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|apple-icon|opengraph-image|twitter-image|robots.txt|sitemap.xml|manifest.webmanifest).*)"],
};
