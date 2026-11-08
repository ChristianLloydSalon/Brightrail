import "server-only";
import { ApiError } from "@/lib/api-error";
import type { NotificationPrefs } from "@/lib/domain/notification-prefs";
import type { Member, MemberStatus, Role, Workspace } from "@/lib/domain/types";
import type { Membership, MemberRepository, PersonName, Profile, ProfileRepository, WorkspaceRepository } from "@/server/application/ports/repositories";
import { dbError, must, mustUnique } from "../errors";
import { toMember, toProfile, toWorkspace } from "../mappers";
import { columns, SupabaseRepository } from "./base";

export class SupabaseWorkspaceRepository extends SupabaseRepository implements WorkspaceRepository {
  async findById(id: string): Promise<Workspace | null> {
    const { data } = await this.db.from("workspaces").select("*").eq("id", id).maybeSingle();
    return data ? toWorkspace(data) : null;
  }

  async slugExists(slug: string): Promise<boolean> {
    const { data, error } = await this.db.from("workspaces").select("id").eq("slug", slug).maybeSingle();
    if (error) throw dbError(error, "create the workspace");
    return !!data;
  }

  async create(row: Parameters<WorkspaceRepository["create"]>[0]): Promise<Workspace> {
    const { data, error } = await this.db.from("workspaces").insert({ name: row.name, slug: row.slug, created_by: row.createdBy, plan: row.plan, quotas: row.quotas, settings: row.settings, grants: row.grants }).select("*").single();
    if (error || !data) throw dbError(error ?? { message: "no row returned" }, "create the workspace");
    return toWorkspace(data);
  }

  async update(id: string, patch: Parameters<WorkspaceRepository["update"]>[1]): Promise<Workspace> {
    const cols = columns(patch, { name: "name", slug: "slug", settings: "settings", grants: "grants", plan: "plan", quotas: "quotas" });
    return toWorkspace(mustUnique(await this.db.from("workspaces").update(cols).eq("id", id).select("*").single()));
  }

  async delete(id: string): Promise<void> {
    await this.db.from("workspaces").delete().eq("id", id);
  }
}

export class SupabaseMemberRepository extends SupabaseRepository implements MemberRepository {
  async activeMembershipsOf(userId: string) {
    const { data, error } = await this.db.from("workspace_members").select("*, workspaces(*)").eq("user_id", userId).eq("status", "active");
    if (error) throw new ApiError("INTERNAL", "Couldn't load your workspaces.");
    return (data ?? []).filter((r) => r.workspaces).map((r) => ({ member: toMember(r), workspace: toWorkspace(r.workspaces) }));
  }

  async membershipsOf(userId: string): Promise<Membership[]> {
    const { data } = await this.db.from("workspace_members").select("*, workspaces(*)").eq("user_id", userId);
    return (data ?? []).map((r) => ({ member: toMember(r), workspace: r.workspaces ? toWorkspace(r.workspaces) : null }));
  }

  async isActiveMember(userId: string, workspaceId: string): Promise<boolean> {
    const { data } = await this.db.from("workspace_members").select("id").eq("user_id", userId).eq("workspace_id", workspaceId).eq("status", "active").maybeSingle();
    return !!data;
  }

  async countSeated(workspaceId: string): Promise<number> {
    const { count } = await this.db.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "suspended");
    return count ?? 0;
  }

  async list(workspaceId: string, filter: { role?: Role; status?: MemberStatus } = {}): Promise<Member[]> {
    let q = this.db.from("workspace_members").select("*").eq("workspace_id", workspaceId);
    if (filter.role) q = q.eq("role", filter.role);
    if (filter.status) q = q.eq("status", filter.status);
    const { data } = await q;
    return (data ?? []).map(toMember);
  }

  async findInWorkspace(workspaceId: string, id: string): Promise<Member | null> {
    const { data, error } = await this.db.from("workspace_members").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    if (error) throw dbError(error, "load the member");
    return data ? toMember(data) : null;
  }

  async existingEmails(workspaceId: string, emails: string[]): Promise<string[]> {
    const { data } = await this.db.from("workspace_members").select("email").eq("workspace_id", workspaceId).in("email", emails);
    return (data ?? []).map((m) => m.email as string);
  }

  async insert(row: Parameters<MemberRepository["insert"]>[0]): Promise<Member> {
    const res = await this.db.from("workspace_members").insert({
      workspace_id: row.workspaceId, user_id: row.userId, email: row.email, name: row.name, role: row.role, status: row.status,
      ...(row.invitedBy ? { invited_by: row.invitedBy } : {}), ...(row.joinedAt ? { joined_at: row.joinedAt } : {}), ...(row.lastActiveAt ? { last_active_at: row.lastActiveAt } : {}),
    }).select("*").single();
    // The founding owner's membership is part of creating a workspace; say so if the database refuses it.
    if (res.error && row.role === "owner") throw dbError(res.error, "create the workspace");
    return toMember(must(res));
  }

  async update(workspaceId: string, id: string, patch: Parameters<MemberRepository["update"]>[2]): Promise<Member> {
    const cols = columns(patch, { role: "role", status: "status", invitedAt: "invited_at" });
    return toMember(must(await this.db.from("workspace_members").update(cols).eq("id", id).eq("workspace_id", workspaceId).select("*").single()));
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    await this.db.from("workspace_members").delete().eq("id", id).eq("workspace_id", workspaceId);
  }

  async deleteMany(workspaceId: string, ids: string[]): Promise<void> {
    await this.db.from("workspace_members").delete().eq("workspace_id", workspaceId).in("id", ids);
  }

  /** Best-effort activity timestamp; never awaited by the caller. */
  touch(id: string, at: string): void {
    void this.db.from("workspace_members").update({ last_active_at: at }).eq("id", id).then(() => undefined);
  }

  async findInvitation(userId: string, memberId: string) {
    const { data } = await this.db.from("workspace_members").select("*, workspaces(name)").eq("id", memberId).eq("user_id", userId).eq("status", "invited").maybeSingle();
    return data ? { member: toMember(data), workspaceName: data.workspaces?.name as string } : null;
  }

  async acceptInvitation(memberId: string, name: string, at: string): Promise<void> {
    await this.db.from("workspace_members").update({ status: "active", joined_at: at, last_active_at: at, name }).eq("id", memberId);
  }

  async declineInvitation(userId: string, memberId: string): Promise<void> {
    await this.db.from("workspace_members").delete().eq("id", memberId).eq("user_id", userId).eq("status", "invited");
  }

  async renameUser(userId: string, name: string): Promise<void> {
    await this.db.from("workspace_members").update({ name }).eq("user_id", userId);
  }

  async ownerships(userId: string) {
    const { data } = await this.db.from("workspace_members").select("workspace_id, role, workspaces(name)").eq("user_id", userId).eq("status", "active");
    return (data ?? []).filter((m) => m.role === "owner").map((m) => ({ workspaceId: m.workspace_id as string, workspaceName: (m.workspaces as unknown as { name: string } | null)?.name ?? "Workspace" }));
  }

  async countOtherPeople(workspaceId: string, userId: string): Promise<number> {
    const { count } = await this.db.from("workspace_members").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("user_id", userId).in("status", ["active", "suspended", "invited"]);
    return count ?? 0;
  }

  async membershipIds(userId: string) {
    const { data } = await this.db.from("workspace_members").select("id, workspace_id").eq("user_id", userId);
    return (data ?? []).map((m) => ({ id: m.id as string, workspaceId: m.workspace_id as string }));
  }

  async firstActiveOwner(workspaceId: string): Promise<string | null> {
    const { data } = await this.db.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("role", "owner").eq("status", "active").order("joined_at").limit(1).maybeSingle();
    return (data?.user_id as string | undefined) ?? null;
  }

  async activeRecipients(workspaceId: string) {
    const { data } = await this.db.from("workspace_members").select("user_id, email, role").eq("workspace_id", workspaceId).eq("status", "active").not("user_id", "is", null);
    return (data ?? []).map((m) => ({ userId: m.user_id as string, email: m.email as string, role: m.role as Role }));
  }
}

export class SupabaseProfileRepository extends SupabaseRepository implements ProfileRepository {
  async names(ids: string[]): Promise<Map<string, PersonName>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const { data } = await this.db.from("profiles").select("id, name, email").in("id", unique);
    return new Map((data ?? []).map((p) => [p.id as string, { name: (p.name as string) ?? "", email: (p.email as string) ?? "" }]));
  }

  async findById(id: string): Promise<Profile | null> {
    const { data } = await this.db.from("profiles").select("*").eq("id", id).maybeSingle();
    return data ? toProfile(data) : null;
  }

  async findByEmail(email: string) {
    const { data } = await this.db.from("profiles").select("id, name").eq("email", email).maybeSingle();
    return data ? { id: data.id as string, name: (data.name as string) ?? "" } : null;
  }

  async update(id: string, patch: Partial<{ name: string; title: string | null; notificationPrefs: NotificationPrefs; onboardingCompletedAt: string }>): Promise<void> {
    const cols = columns(patch, { name: "name", title: "title", notificationPrefs: "notification_prefs", onboardingCompletedAt: "onboarding_completed_at" });
    const { error } = await this.db.from("profiles").update(cols).eq("id", id);
    if (error) throw dbError(error, patch.notificationPrefs ? "save your notification preferences" : "save your profile");
  }

  async prefsFor(ids: string[]): Promise<Map<string, unknown>> {
    if (!ids.length) return new Map();
    const { data } = await this.db.from("profiles").select("id, notification_prefs").in("id", ids);
    return new Map((data ?? []).map((p) => [p.id as string, p.notification_prefs]));
  }
}
