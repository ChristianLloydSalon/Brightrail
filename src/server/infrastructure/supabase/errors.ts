import "server-only";
import { ApiError } from "@/lib/api-error";
import { DuplicateKeyError } from "@/server/application/shared/errors";

export type PgError = { code?: string; message: string };

/**
 * Turns a database error into a message that says how to fix it. Setup problems are the usual
 * cause on a fresh install, so they get specific guidance; everything else is logged.
 */
export function dbError(error: PgError, what: string): ApiError {
  console.error(`[brightrail] database error while trying to ${what}:`, error.code, error.message);
  const m = error.message ?? "";
  if (error.code === "42501" || /permission denied/i.test(m))
    return new ApiError("NOT_CONFIGURED", `Couldn't ${what}: the database hasn't granted Brightrail access to its tables. In Supabase → SQL Editor, run supabase/migrations/0003_grants.sql, then try again.`);
  if (error.code === "PGRST205" || error.code === "42P01" || /could not find the table|does not exist/i.test(m))
    return new ApiError("NOT_CONFIGURED", `Couldn't ${what}: the database tables don't exist yet. In Supabase → SQL Editor, run the files in supabase/migrations in order (0001, 0002, 0003).`);
  if (/invalid api key|no api key|jwt|jws/i.test(m))
    return new ApiError("NOT_CONFIGURED", `Couldn't ${what}: Supabase rejected the server key. Check SUPABASE_SERVICE_ROLE_KEY in .env (the service_role / secret key, not the anon key) and restart the dev server.`);
  if (error.code === "23505") return new ApiError("CONFLICT", "That name is already in use.");
  return new ApiError("INTERNAL", `Couldn't ${what}. The server log has the details.`);
}

/** Unwraps a Supabase response, mapping database errors to API errors. */
export function must<T>(res: { data: T; error: PgError | null }, notFound = "Not found."): NonNullable<T> {
  if (res.error) {
    if (res.error.code === "PGRST116") throw new ApiError("NOT_FOUND", notFound);
    throw dbError(res.error, "complete that");
  }
  if (res.data === null || res.data === undefined) throw new ApiError("NOT_FOUND", notFound);
  return res.data as NonNullable<T>;
}

/** Like `must`, but a unique-key violation becomes a DuplicateKeyError for the use case to explain. */
export function mustUnique<T>(res: { data: T; error: PgError | null }, notFound?: string): NonNullable<T> {
  if (res.error?.code === "23505") throw new DuplicateKeyError();
  return must(res, notFound);
}
