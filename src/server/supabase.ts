import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { ApiError } from "@/lib/api-error";
import { env } from "./env";

function assertConfigured() {
  if (!env.supabaseUrl || !env.supabaseAnonKey)
    throw new ApiError("NOT_CONFIGURED", "Supabase isn't configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env (see SETUP.md).");
}

/** Supabase client acting as the signed-in user. Reads are filtered by row-level security. */
export async function userClient(): Promise<SupabaseClient> {
  assertConfigured();
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component render; the proxy refreshes the session cookie instead.
        }
      },
    },
  });
}

let admin: SupabaseClient | null = null;
/**
 * Service-role client. Bypasses RLS, so it's used only after the caller's identity, workspace
 * membership and permission have been checked in code (see context.ts), and by the worker.
 */
export function adminClient(): SupabaseClient {
  assertConfigured();
  if (!env.supabaseServiceRoleKey) throw new ApiError("NOT_CONFIGURED", "SUPABASE_SERVICE_ROLE_KEY is missing from .env (see SETUP.md).");
  admin ??= createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
