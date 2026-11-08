import "server-only";
import { cookies } from "next/headers";
import type { WorkspacePreference } from "@/server/application/ports/services";

export const WS_COOKIE = "ff_ws";

/** The active-workspace preference, kept in an httpOnly cookie. Honoured only for active memberships. */
export class CookieWorkspacePreference implements WorkspacePreference {
  async get() {
    return (await cookies()).get(WS_COOKIE)?.value;
  }

  async set(workspaceId: string) {
    (await cookies()).set(WS_COOKIE, workspaceId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  }

  async clear() {
    (await cookies()).delete(WS_COOKIE);
  }
}
