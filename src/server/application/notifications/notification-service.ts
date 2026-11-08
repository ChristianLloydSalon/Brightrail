import { ApiError } from "@/lib/api-error";
import { allowedFor, DEFAULT_NOTIFICATION_PREFS, normalizePrefs, PREF_FOR } from "@/lib/domain/notification-prefs";
import type { AppNotification, RoleGrants } from "@/lib/domain/types";
import type { ApprovalRepository, MemberRepository, NotificationRepository, ProfileRepository, WorkspaceRepository } from "../ports/repositories";
import type { AppConfig, EventBus } from "../ports/services";
import type { RequestContext } from "../shared/context";

export type NewNotification = Pick<AppNotification, "workspaceId" | "kind" | "title" | "body" | "href">;
export interface EmailPlan { title: string; body: string; url: string; workspace: string; to: Array<{ userId: string; email: string }> }

/** Notifications are workspace-wide; read state is per person. Anything from before someone joined counts as read. */
const memberSince = (m: { joinedAt?: string | null; invitedAt?: string | null }) => m.joinedAt ?? m.invitedAt ?? "1970-01-01T00:00:00Z";

export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly members: MemberRepository,
    private readonly profiles: ProfileRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly approvals: ApprovalRepository,
    private readonly bus: EventBus,
    private readonly config: AppConfig,
  ) {}

  /** Inserts the in-app notification and queues the email fan-out. Never blocks or fails the caller. */
  async create(n: NewNotification): Promise<void> {
    const id = await this.notifications.insert(n);
    if (!id) return;
    if (!this.config.emailNotificationsAvailable) return;
    try {
      await this.bus.notificationCreated(id);
    } catch (e) {
      console.error("[brightrail] couldn't queue notification email", (e as Error).message);
    }
  }

  /** Each opted-in, permitted, active member who should get this notification by email. */
  async emailPlan(notificationId: string): Promise<EmailPlan | null> {
    const n = await this.notifications.findById(notificationId);
    if (!n) return null;
    const pref = PREF_FOR[n.kind];
    if (!pref) return null;
    const ws = await this.workspaces.findById(n.workspaceId);
    const members = await this.members.activeRecipients(n.workspaceId);
    const prefs = await this.profiles.prefsFor(members.map((m) => m.userId));
    const to = members
      .filter((m) => allowedFor(n.kind, m.role, (ws?.grants ?? {}) as RoleGrants))
      .filter((m) => (prefs.has(m.userId) ? normalizePrefs(prefs.get(m.userId)) : DEFAULT_NOTIFICATION_PREFS)[pref].email)
      .map((m) => ({ userId: m.userId, email: m.email }));
    return { title: n.title, body: n.body, url: `${this.config.appUrl}${n.href}`, workspace: ws?.name ?? "Brightrail", to };
  }

  async list(ctx: RequestContext): Promise<AppNotification[]> {
    const rows = await this.notifications.recent(ctx.workspaceId, 20);
    if (!rows.length) return [];
    const read = await this.notifications.readIds(ctx.user.id, rows.map((r) => r.id));
    const since = memberSince(ctx.member);
    return rows.map((r) => ({ ...r, read: read.has(r.id) || r.createdAt < since }));
  }

  /** Unread notifications for this person and pending approvals in the workspace (the nav badges). */
  async badgeCounts(ctx: RequestContext): Promise<{ notifications: number; approvals: number }> {
    const [notifications, approvals] = await Promise.all([
      this.notifications.unreadCount(ctx.workspaceId, ctx.user.id, memberSince(ctx.member)),
      this.approvals.countPending(ctx.workspaceId),
    ]);
    return { notifications, approvals };
  }

  async markRead(ctx: RequestContext, ids: string[] | "all") {
    if (ids === "all") {
      await this.notifications.markAllRead(ctx.workspaceId, ctx.user.id);
      return { ok: true };
    }
    if (!Array.isArray(ids) || ids.length > 200) throw new ApiError("VALIDATION", "Invalid notification list.");
    // Only ids that belong to this workspace.
    const own = await this.notifications.idsInWorkspace(ctx.workspaceId, ids);
    if (own.length) await this.notifications.markRead(ctx.workspaceId, ctx.user.id, own);
    return { ok: true };
  }
}
