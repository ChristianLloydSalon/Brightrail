import "server-only";
import { ApiError, type Result } from "@/lib/api-error";
import type { Permission } from "@/lib/domain/types";
import type { RequestContext, SessionUser } from "../application/shared/context";
import { container, type Container } from "../container";

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
 * Runs a use case inside the caller's workspace. Authentication, tenant resolution and the permission
 * check happen here, once, before any service code runs.
 */
export function inWorkspace<T>(permission: Permission | undefined, fn: (app: Container, ctx: RequestContext) => Promise<T>): Promise<Result<T>> {
  return act(async () => {
    const app = container();
    return fn(app, await app.session.context(permission));
  });
}

/** Runs a use case for the signed-in person, outside any workspace (profile, invitations, account). */
export function asUser<T>(fn: (app: Container, user: SessionUser) => Promise<T>): Promise<Result<T>> {
  return act(async () => {
    const app = container();
    return fn(app, await app.session.user());
  });
}
