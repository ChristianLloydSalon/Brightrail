import { ApiError } from "@/lib/api-error";
import { assignableRoles } from "@/lib/domain/permissions";
import type { Member, Role } from "@/lib/domain/types";
import type { MemberRepository, ProfileRepository } from "../ports/repositories";
import type { AuditLog } from "../shared/audit-log";
import type { RequestContext } from "../shared/context";
import { fieldError, found } from "../shared/errors";
import type { HourlyQuota } from "../shared/throttle";
import type { InvitationSender } from "./invitation-sender";

export interface MemberRow extends Member { isYou: boolean }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, editor: 2, operator: 3, viewer: 4 };
const label = (m: Member) => m.name || m.email;

/** Membership: invitations, roles, suspension, removal and ownership transfer. */
export class MemberService {
  constructor(
    private readonly members: MemberRepository,
    private readonly profiles: ProfileRepository,
    private readonly invitations: InvitationSender,
    private readonly quota: HourlyQuota,
    private readonly audit: AuditLog,
  ) {}

  private async find(ctx: RequestContext, id: string): Promise<Member> {
    return found(await this.members.findInWorkspace(ctx.workspaceId, id), "Member not found.");
  }

  /** Hourly cap on invitation emails sent through Brightrail's own email key. */
  private throttle(key: string, max: number, times = 1) {
    return this.quota.consume(key, max, { times, logLabel: "invitation throttle", unavailable: "Invitations are temporarily unavailable. Try again later.", exceeded: "Too many invitation emails this hour. Try again later." });
  }

  async list(ctx: RequestContext, params: { search?: string; role?: Role | "all"; status?: Member["status"] | "all" } = {}): Promise<MemberRow[]> {
    const rows = await this.members.list(ctx.workspaceId, { role: params.role !== "all" ? params.role : undefined, status: params.status !== "all" ? params.status : undefined });
    let items = rows.map((m) => ({ ...m, isYou: m.userId === ctx.user.id }));
    const s = params.search?.trim().toLowerCase();
    if (s) items = items.filter((m) => m.name.toLowerCase().includes(s) || m.email.toLowerCase().includes(s));
    return items.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || label(a).localeCompare(label(b)));
  }

  /** Sends an invite email to new users; existing users see the invitation when they sign in. */
  async invite(ctx: RequestContext, input: { emails: string[]; role: Role; message?: string }): Promise<Member[]> {
    const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) throw fieldError({ emails: "Enter at least one email address." });
    if (emails.length > 20) throw fieldError({ emails: "Invite up to 20 people at a time." });
    await this.throttle(`invites:${ctx.workspaceId}`, 50, emails.length);
    const bad = emails.filter((e) => !EMAIL.test(e));
    if (bad.length) throw fieldError({ emails: `Not a valid email: ${bad.join(", ")}` });
    if (!assignableRoles(ctx.member.role).includes(input.role)) throw new ApiError("FORBIDDEN", "You can't assign that role.");
    const existing = await this.members.existingEmails(ctx.workspaceId, emails);
    if (existing.length) throw fieldError({ emails: `Already in this workspace: ${existing.join(", ")}` }, "CONFLICT");
    const limit = ctx.workspace.quotas.members;
    if ((await this.members.countSeated(ctx.workspaceId)) + emails.length > limit) throw new ApiError("CONFLICT", `This workspace allows ${limit} members.`);
    const created: Member[] = [];
    for (const email of emails) {
      const profile = await this.profiles.findByEmail(email);
      const userId = await this.invitations.send(ctx, email, profile?.id ?? null, input.role);
      const m = await this.members.insert({ workspaceId: ctx.workspaceId, userId, email, name: profile?.name ?? "", role: input.role, status: "invited", invitedBy: ctx.user.id });
      created.push(m);
      await this.audit.record(ctx, { action: "member.invited", category: "member", resourceType: "member", resourceId: m.id, resourceName: email, metadata: { role: input.role } });
    }
    // The quota check above can race with a concurrent invite; re-count and undo this batch if it overshot.
    if ((await this.members.countSeated(ctx.workspaceId)) > limit) {
      await this.members.deleteMany(ctx.workspaceId, created.map((m) => m.id));
      throw new ApiError("CONFLICT", `This workspace allows ${limit} members.`);
    }
    return created;
  }

  async changeRole(ctx: RequestContext, memberId: string, role: Role): Promise<Member> {
    const m = await this.find(ctx, memberId);
    if (m.role === "owner") throw new ApiError("FORBIDDEN", "The owner's role can't be changed.");
    if (m.userId === ctx.user.id) throw new ApiError("FORBIDDEN", "You can't change your own role.");
    if (!assignableRoles(ctx.member.role).includes(role) || (ctx.member.role === "admin" && m.role === "admin")) throw new ApiError("FORBIDDEN", "You can't assign that role.");
    const updated = await this.members.update(ctx.workspaceId, memberId, { role });
    await this.audit.record(ctx, { action: "member.role_changed", category: "member", resourceType: "member", resourceId: memberId, resourceName: label(m), metadata: { from: m.role, to: role } });
    return updated;
  }

  /** Owner hands the workspace to another active member; the previous owner becomes an Admin. */
  async transferOwnership(ctx: RequestContext, memberId: string) {
    if (!ctx.isOwner) throw new ApiError("FORBIDDEN", "Only the owner can transfer ownership.");
    const m = await this.find(ctx, memberId);
    if (m.userId === ctx.user.id) throw new ApiError("CONFLICT", "You already own this workspace.");
    if (m.status !== "active" || !m.userId) throw new ApiError("CONFLICT", "Ownership can only go to an active member who has joined.");
    await this.members.update(ctx.workspaceId, memberId, { role: "owner" });
    await this.members.update(ctx.workspaceId, ctx.member.id, { role: "admin" });
    await this.audit.record(ctx, { action: "workspace.ownership_transferred", category: "workspace", resourceType: "workspace", resourceId: ctx.workspaceId, resourceName: ctx.workspace.name, metadata: { from: ctx.user.name, to: label(m) } });
    return { ok: true };
  }

  async setSuspended(ctx: RequestContext, memberId: string, suspended: boolean): Promise<Member> {
    const m = await this.find(ctx, memberId);
    if (m.role === "owner" || m.userId === ctx.user.id) throw new ApiError("FORBIDDEN", "You can't suspend this member.");
    if (!ctx.isOwner && m.role === "admin") throw new ApiError("FORBIDDEN", "Only the owner can suspend an admin.");
    if (m.status === "invited") throw new ApiError("CONFLICT", "Revoke the invitation instead.");
    const updated = await this.members.update(ctx.workspaceId, memberId, { status: suspended ? "suspended" : "active" });
    await this.audit.record(ctx, { action: suspended ? "member.suspended" : "member.reactivated", category: "member", resourceType: "member", resourceId: memberId, resourceName: label(m), metadata: {} });
    return updated;
  }

  async remove(ctx: RequestContext, memberId: string) {
    const m = await this.find(ctx, memberId);
    if (m.role === "owner") throw new ApiError("FORBIDDEN", "The owner can't be removed.");
    if (m.userId === ctx.user.id) throw new ApiError("FORBIDDEN", "You can't remove yourself here.");
    if (!ctx.isOwner && m.role === "admin") throw new ApiError("FORBIDDEN", "Only the owner can remove an admin.");
    await this.members.delete(ctx.workspaceId, memberId);
    await this.audit.record(ctx, { action: m.status === "invited" ? "member.invite_revoked" : "member.removed", category: "member", resourceType: "member", resourceId: memberId, resourceName: label(m), metadata: { role: m.role } });
    return { ok: true };
  }

  async resendInvite(ctx: RequestContext, memberId: string): Promise<Member> {
    const m = await this.find(ctx, memberId);
    if (m.status !== "invited") throw new ApiError("CONFLICT", "Only pending invitations can be resent.");
    await this.throttle(`invite-resend:${m.id}`, 3);
    const profile = await this.profiles.findByEmail(m.email);
    await this.invitations.send(ctx, m.email, profile?.id ?? null, m.role);
    const updated = await this.members.update(ctx.workspaceId, memberId, { invitedAt: new Date().toISOString() });
    await this.audit.record(ctx, { action: "member.invite_resent", category: "member", resourceType: "member", resourceId: memberId, resourceName: m.email, metadata: {} });
    return updated;
  }
}
