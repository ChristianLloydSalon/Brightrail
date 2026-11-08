import { ApiError } from "@/lib/api-error";
import { can, DEFAULT_GRANTS } from "@/lib/domain/permissions";
import type { Member, Permission, Workspace } from "@/lib/domain/types";
import type { Actor } from "../ports/repositories";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/**
 * The authenticated caller, resolved from an authorized, active membership. Every use case that acts
 * inside a workspace receives one; it owns the permission rule so no service re-implements it.
 */
export class RequestContext {
  constructor(
    readonly user: SessionUser,
    readonly member: Member,
    readonly workspace: Workspace,
  ) {}

  get workspaceId(): string {
    return this.workspace.id;
  }

  /** The signed-in person as an audit actor. */
  get actor(): Actor {
    return { type: "user", id: this.user.id, name: this.user.name };
  }

  can(permission: Permission): boolean {
    return can(this.member.role, permission, { ...DEFAULT_GRANTS, ...this.workspace.grants });
  }

  /** Throws FORBIDDEN unless the caller's role (with this workspace's grants) allows `permission`. */
  require(permission: Permission): this {
    if (!this.can(permission)) throw new ApiError("FORBIDDEN", `Your role (${this.member.role}) doesn't allow this action.`);
    return this;
  }

  get isOwner(): boolean {
    return this.member.role === "owner";
  }
}
