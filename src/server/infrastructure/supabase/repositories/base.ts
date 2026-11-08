import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Resolves the client lazily, so the container can be built before configuration is checked. */
export type DbProvider = () => SupabaseClient;

/**
 * Base for Supabase-backed repositories. They run with the service-role client, so every method that
 * acts for a user takes the workspace id and filters on it: tenancy is enforced here, not by RLS.
 */
export abstract class SupabaseRepository {
  constructor(private readonly provider: DbProvider) {}

  protected get db(): SupabaseClient {
    return this.provider();
  }
}

/** Drops undefined keys and renames camelCase patch fields to their column names. */
export function columns<T extends object>(patch: T, map: { [K in keyof T]-?: string }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) out[map[k as keyof T]] = v;
  return out;
}
