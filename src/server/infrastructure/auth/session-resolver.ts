import "server-only";
import { ApiError } from "@/lib/api-error";
import type { Permission } from "@/lib/domain/types";
import type { MemberRepository } from "@/server/application/ports/repositories";
import type { WorkspacePreference } from "@/server/application/ports/services";
import { RequestContext, type SessionUser } from "@/server/application/shared/context";
import { userClient } from "../supabase/clients";
import type { DbProvider } from "../supabase/repositories/base";

/**
 * Who is calling. The session comes from the Supabase auth cookie; the tenant from an authorized,
 * active membership. The workspace cookie is only a preference: it's honoured only if the user is an
 * active member of that workspace.
 */
export class SessionResolver {
  constructor(
    private readonly admin: DbProvider,
    private readonly members: MemberRepository,
    private readonly preference: WorkspacePreference,
  ) {}

  async user(): Promise<SessionUser> {
    const sb = await userClient();
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) throw new ApiError("UNAUTHENTICATED", "Sign in to continue.");
    // Two-factor: a password (or Google/GitHub) alone isn't enough once a person has set up an authenticator.
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") throw new ApiError("UNAUTHENTICATED", "Enter the code from your authenticator app to continue.");
    const { data: profile } = await this.admin().from("profiles").select("name, email").eq("id", data.user.id).maybeSingle();
    const meta = data.user.user_metadata ?? {};
    return { id: data.user.id, email: data.user.email ?? profile?.email ?? "", name: profile?.name || (meta.name as string) || (meta.full_name as string) || data.user.email || "" };
  }

  /** The caller inside their active workspace, optionally requiring a permission. */
  async context(permission?: Permission): Promise<RequestContext> {
    const user = await this.user();
    const rows = await this.members.activeMembershipsOf(user.id);
    if (!rows.length) throw new ApiError("FORBIDDEN", "You don't belong to a workspace yet.", { workspace: "none" });
    const preferred = await this.preference.get();
    const row = rows.find((r) => r.member.workspaceId === preferred) ?? rows[0]!;
    const ctx = new RequestContext(user, row.member, row.workspace);
    if (permission) ctx.require(permission);
    this.members.touch(row.member.id, new Date().toISOString());
    return ctx;
  }
}
