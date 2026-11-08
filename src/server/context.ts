import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { ApiError, type Result } from "@/lib/api-error";
import { can as canFn, DEFAULT_GRANTS } from "@/lib/domain/permissions";
import type { AuditEvent, Member, Permission, Role, Workspace } from "@/lib/domain/types";
import { adminClient, userClient } from "./supabase";
import { toMember, toWorkspace } from "./rows";

export const WS_COOKIE = "ff_ws";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function getSessionUser(): Promise<SessionUser> {
  const sb = await userClient();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) throw new ApiError("UNAUTHENTICATED", "Sign in to continue.");
  // Two-factor: a password (or Google/GitHub) alone isn't enough once a person has set up an authenticator.
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") throw new ApiError("UNAUTHENTICATED", "Enter the code from your authenticator app to continue.");
  const db = adminClient();
  const { data: profile } = await db.from("profiles").select("name, email").eq("id", data.user.id).maybeSingle();
  return { id: data.user.id, email: data.user.email ?? profile?.email ?? "", name: profile?.name || (data.user.user_metadata?.name as string) || (data.user.user_metadata?.full_name as string) || data.user.email || "" };
}

export type AuditInput = Omit<AuditEvent, "id" | "workspaceId" | "createdAt" | "actor"> & { actor?: AuditEvent["actor"] };

export interface RequestContext {
  db: SupabaseClient;
  user: SessionUser;
  member: Member;
  workspace: Workspace;
  can: (p: Permission) => boolean;
  audit: (e: AuditInput) => Promise<void>;
  now: () => string;
}

/**
 * Resolves the caller's tenant from an authorized, active membership. The workspace cookie is only
 * a preference: it's honoured only if the user is an active member of that workspace.
 */
export async function getContext(permission?: Permission): Promise<RequestContext> {
  const user = await getSessionUser();
  const db = adminClient();
  const { data: rows, error } = await db.from("workspace_members").select("*, workspaces(*)").eq("user_id", user.id).eq("status", "active");
  if (error) throw new ApiError("INTERNAL", "Couldn't load your workspaces.");
  if (!rows?.length) throw new ApiError("FORBIDDEN", "You don't belong to a workspace yet.", { workspace: "none" });
  const preferred = (await cookies()).get(WS_COOKIE)?.value;
  const row = rows.find((r) => r.workspace_id === preferred) ?? rows[0]!;
  const member = toMember(row);
  const workspace = toWorkspace(row.workspaces);
  const can = (p: Permission) => canFn(member.role as Role, p, { ...DEFAULT_GRANTS, ...workspace.grants });
  if (permission && !can(permission)) throw new ApiError("FORBIDDEN", `Your role (${member.role}) doesn't allow this action.`);
  // Best-effort activity timestamp.
  void db.from("workspace_members").update({ last_active_at: new Date().toISOString() }).eq("id", member.id).then(() => undefined);
  return {
    db,
    user,
    member,
    workspace,
    can,
    now: () => new Date().toISOString(),
    audit: async (e) => {
      await db.from("audit_events").insert({
        workspace_id: workspace.id,
        actor: e.actor ?? { type: "user", id: user.id, name: user.name },
        action: e.action,
        category: e.category,
        resource_type: e.resourceType,
        resource_id: e.resourceId,
        resource_name: e.resourceName,
        metadata: e.metadata,
      });
    },
  };
}

/** Wraps a server action so errors cross the server/client boundary intact (Next hides thrown messages in production). */
export async function act<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: e.toJSON() };
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_")) throw e;
    console.error("[brightrail] unexpected error", e);
    return { ok: false, error: new ApiError("INTERNAL", "Something went wrong on our side. Try again in a moment.").toJSON() };
  }
}

/**
 * Turns a database error into a message that says how to fix it. Setup problems are the usual
 * cause on a fresh install, so they get specific guidance; everything else is logged.
 */
export function dbError(error: { code?: string; message: string }, what: string): ApiError {
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
export function must<T>(res: { data: T; error: { code?: string; message: string } | null }, notFound = "Not found."): NonNullable<T> {
  if (res.error) {
    if (res.error.code === "PGRST116") throw new ApiError("NOT_FOUND", notFound);
    throw dbError(res.error, "complete that");
  }
  if (res.data === null || res.data === undefined) throw new ApiError("NOT_FOUND", notFound);
  return res.data as NonNullable<T>;
}
