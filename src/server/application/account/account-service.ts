import { ApiError } from "@/lib/api-error";
import { normalizePrefs, type NotificationPrefs } from "@/lib/domain/notification-prefs";
import { DEFAULT_GRANTS } from "@/lib/domain/permissions";
import { PLANS } from "@/lib/domain/plans";
import type { Role, Workspace } from "@/lib/domain/types";
import { baseSlugFor } from "@/lib/domain/workspace-rules";
import type { ApiKeyRepository, MemberRepository, ProfileRepository, WorkflowRepository, WorkspaceRepository } from "../ports/repositories";
import type { AppConfig, IdentityAdmin, WorkspacePreference } from "../ports/services";
import type { AuditLog } from "../shared/audit-log";
import type { SessionUser } from "../shared/context";
import { fieldError } from "../shared/errors";

export interface MeInfo {
  user: { id: string; email: string; name: string; title?: string; onboardingCompletedAt: string | null; notificationPrefs: NotificationPrefs };
  /** Whether Brightrail can send notification emails (RESEND_API_KEY + EMAIL_FROM set). */
  emailNotificationsAvailable: boolean;
  workspaces: Array<Workspace & { role: Role }>;
  activeWorkspaceId: string | null;
  invitations: Array<{ memberId: string; workspaceId: string; workspaceName: string; role: Role; invitedByName: string }>;
}

/** Settings every new workspace starts with (the stored defaults, with the creator's time zone). */
export type DefaultSettings = Workspace["settings"];

/** The signed-in person: their profile, workspaces, invitations and account lifecycle. */
export class AccountService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly members: MemberRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly workflows: WorkflowRepository,
    private readonly apiKeys: ApiKeyRepository,
    private readonly identity: IdentityAdmin,
    private readonly preference: WorkspacePreference,
    private readonly audit: AuditLog,
    private readonly config: AppConfig,
    private readonly defaultSettings: DefaultSettings,
  ) {}

  async me(user: SessionUser): Promise<MeInfo> {
    const profile = await this.profiles.findById(user.id);
    const rows = await this.members.membershipsOf(user.id);
    const active = rows.filter((r) => r.member.status === "active" && r.workspace);
    const pending = rows.filter((r) => r.member.status === "invited" && r.workspace);
    const inviters = await this.profiles.names(pending.map((r) => r.member.invitedBy).filter((x): x is string => !!x));
    const preferred = (await this.preference.get()) ?? null;
    const workspaces = active.map((r) => ({ ...r.workspace!, role: r.member.role }));
    return {
      user: { id: user.id, email: user.email, name: user.name, title: profile?.title ?? undefined, onboardingCompletedAt: profile?.onboardingCompletedAt ?? null, notificationPrefs: normalizePrefs(profile?.notificationPrefs) },
      emailNotificationsAvailable: this.config.emailNotificationsAvailable,
      workspaces,
      activeWorkspaceId: workspaces.find((w) => w.id === preferred)?.id ?? workspaces[0]?.id ?? null,
      invitations: pending.map((r) => {
        const inv = r.member.invitedBy ? inviters.get(r.member.invitedBy) : undefined;
        return { memberId: r.member.id, workspaceId: r.member.workspaceId, workspaceName: r.workspace!.name, role: r.member.role, invitedByName: inv?.name || inv?.email || "A teammate" };
      }),
    };
  }

  async setActiveWorkspace(user: SessionUser, workspaceId: string) {
    if (!(await this.members.isActiveMember(user.id, workspaceId))) throw new ApiError("FORBIDDEN", "You're not a member of that workspace.");
    await this.preference.set(workspaceId);
    return { ok: true };
  }

  async createWorkspace(user: SessionUser, name: string, timezone?: string): Promise<Workspace> {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 80) throw fieldError({ name: "Use 2 to 80 characters." });
    let slug = baseSlugFor(trimmed);
    if (await this.workspaces.slugExists(slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
    const ws = await this.workspaces.create({ name: trimmed, slug, createdBy: user.id, plan: "free", quotas: PLANS.free.quotas, settings: { ...this.defaultSettings, timezone: timezone || "UTC" }, grants: DEFAULT_GRANTS });
    const now = new Date().toISOString();
    try {
      await this.members.insert({ workspaceId: ws.id, userId: user.id, email: user.email, name: user.name, role: "owner", status: "active", joinedAt: now, lastActiveAt: now });
    } catch (e) {
      await this.workspaces.delete(ws.id); // don't leave a workspace nobody owns
      throw e;
    }
    await this.audit.recordFor(ws.id, { type: "user", id: user.id, name: user.name }, { action: "workspace.created", category: "workspace", resourceType: "workspace", resourceId: ws.id, resourceName: ws.name, metadata: {} });
    await this.preference.set(ws.id);
    return ws;
  }

  async acceptInvitation(user: SessionUser, memberId: string) {
    const inv = await this.members.findInvitation(user.id, memberId);
    if (!inv) throw new ApiError("NOT_FOUND", "This invitation is no longer available.");
    // Only someone who has proven they own the invited address may accept: otherwise anyone could
    // register an invitee's email first (when email confirmation is off) and take the invitation.
    const confirmed = (await this.identity.confirmedEmail(user.id))?.toLowerCase() ?? null;
    if (!confirmed || confirmed !== inv.member.email.toLowerCase()) throw new ApiError("FORBIDDEN", "Confirm the email address this invitation was sent to, then try again.");
    await this.members.acceptInvitation(memberId, user.name, new Date().toISOString());
    await this.audit.recordFor(inv.member.workspaceId, { type: "user", id: user.id, name: user.name }, { action: "member.joined", category: "member", resourceType: "member", resourceId: memberId, resourceName: user.email, metadata: { role: inv.member.role } });
    await this.preference.set(inv.member.workspaceId);
    return { workspaceId: inv.member.workspaceId, workspaceName: inv.workspaceName };
  }

  async declineInvitation(user: SessionUser, memberId: string) {
    await this.members.declineInvitation(user.id, memberId);
    return { ok: true };
  }

  async updateProfile(user: SessionUser, input: { name: string; title?: string }) {
    if (input.name.trim().length < 2) throw fieldError({ name: "Enter your full name." });
    await this.profiles.update(user.id, { name: input.name.trim(), title: input.title?.trim() || null });
    await this.members.renameUser(user.id, input.name.trim());
    return { ok: true };
  }

  async updateNotificationPrefs(user: SessionUser, prefs: NotificationPrefs) {
    const clean = normalizePrefs(prefs);
    await this.profiles.update(user.id, { notificationPrefs: clean });
    return clean;
  }

  async completeOnboarding(user: SessionUser) {
    await this.profiles.update(user.id, { onboardingCompletedAt: new Date().toISOString() });
    return { ok: true };
  }

  /** What deleting the account would do: workspaces that block it, and solo workspaces that would be deleted. */
  async deletionCheck(user: SessionUser) {
    const blocking: Array<{ id: string; name: string }> = [];
    const deleting: Array<{ id: string; name: string }> = [];
    for (const o of await this.members.ownerships(user.id)) {
      const w = { id: o.workspaceId, name: o.workspaceName };
      if ((await this.members.countOtherPeople(o.workspaceId, user.id)) > 0) blocking.push(w);
      else deleting.push(w);
    }
    return { email: user.email, blocking, deleting };
  }

  /**
   * Permanently deletes the signed-in person's account. Blocked while they own a workspace with other
   * members (transfer ownership first). Workspaces where they're the only member are deleted; in the rest,
   * their workflows move to the workspace owner and API keys they created are revoked.
   */
  async deleteAccount(user: SessionUser, confirmEmail: string) {
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) throw fieldError({ confirm: "Type your email address exactly." });
    const check = await this.deletionCheck(user);
    if (check.blocking.length) throw new ApiError("CONFLICT", `Transfer ownership of ${check.blocking.map((w) => `“${w.name}”`).join(", ")} first (Settings → Members), or remove the other members.`);
    const solo = new Set(check.deleting.map((w) => w.id));
    for (const m of await this.members.membershipIds(user.id)) {
      if (solo.has(m.workspaceId)) continue;
      const owner = await this.members.firstActiveOwner(m.workspaceId);
      if (owner) await this.workflows.reassignOwner(m.workspaceId, user.id, owner);
      await this.apiKeys.revokeCreatedBy(m.workspaceId, user.id);
      await this.audit.recordFor(m.workspaceId, { type: "user", id: user.id, name: user.name }, { action: "member.account_deleted", category: "member", resourceType: "member", resourceId: m.id, resourceName: user.email, metadata: { workflowsReassigned: true, apiKeysRevoked: true } });
    }
    // Delete the user first: if that fails (it throws), their solo workspaces are still intact.
    await this.identity.deleteUser(user.id);
    for (const id of solo) await this.workspaces.delete(id);
    await this.preference.clear();
    return { ok: true };
  }
}
