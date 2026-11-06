import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseUrl } from "@/lib/supabase-url";

const PUBLIC = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/auth", "/api/inngest", "/api/v1", "/setup"];
const MFA_PAGE = "/mfa";

/**
 * Refreshes the Supabase session cookie on every request and sends signed-out visitors to sign-in.
 * Authorization is still enforced per request in the server actions.
 */
export async function proxy(request: NextRequest) {
  const url = supabaseUrl();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const path = request.nextUrl.pathname;
  if (!url || !key) return path.startsWith("/setup") || path.startsWith("/api") ? NextResponse.next() : NextResponse.redirect(new URL("/setup", request.url));

  let response = NextResponse.next({ request });
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await sb.auth.getUser();
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));
  if (!data.user && !isPublic && path !== "/") {
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
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
