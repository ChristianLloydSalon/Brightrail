import "server-only";
import { env } from "../config/env";

type Providers = { google: boolean; github: boolean };

/** Which social sign-ins are switched on in Supabase (public; shown on the sign-in page). Cached for a minute. */
export class SupabaseAuthProviders {
  private cache: { at: number; value: Providers } | null = null;

  async enabled(): Promise<Providers> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.value;
    let value: Providers = { google: false, github: false };
    try {
      if (env.supabaseUrl && env.supabaseAnonKey) {
        const res = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseAnonKey }, signal: AbortSignal.timeout(5000) });
        const j = (await res.json()) as { external?: Record<string, boolean> };
        value = { google: !!j.external?.google, github: !!j.external?.github };
      }
    } catch {
      /* fall back to email/password only */
    }
    this.cache = { at: Date.now(), value };
    return value;
  }
}
