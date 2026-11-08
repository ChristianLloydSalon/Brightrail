"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api-error";
import { supabaseUrl } from "@/lib/supabase-url";

let client: SupabaseClient | null = null;

/** Browser Supabase client, used only for authentication. Data access goes through server actions. */
export function supabaseBrowser(): SupabaseClient {
  const url = supabaseUrl();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new ApiError("NOT_CONFIGURED", "Supabase isn't configured yet. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env (open /setup to see what's wrong), then restart the dev server (see SETUP.md).");
  client ??= createBrowserClient(url, key);
  return client;
}
