import "server-only";
import { ApiError } from "@/lib/api-error";
import type { ApiKey, AppNotification, AuditEvent } from "@/lib/domain/types";
import type { Actor, ApiKeyRepository, AuditQuery, AuditRepository, NotificationRepository } from "@/server/application/ports/repositories";
import type { RateLimiter } from "@/server/application/ports/services";
import { must } from "../errors";
import { toApiKey, toAudit, toNotification } from "../mappers";
import { SupabaseRepository } from "./base";

export class SupabaseApiKeyRepository extends SupabaseRepository implements ApiKeyRepository {
  async list(workspaceId: string): Promise<ApiKey[]> {
    const { data } = await this.db.from("api_keys").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
    return (data ?? []).map(toApiKey);
  }

  async insert(row: Parameters<ApiKeyRepository["insert"]>[0]): Promise<ApiKey> {
    return toApiKey(must(await this.db.from("api_keys").insert({
      workspace_id: row.workspaceId, name: row.name, prefix: row.prefix, hint: row.hint, key_hash: row.keyHash, scopes: row.scopes, created_by: row.createdBy, expires_at: row.expiresAt,
    }).select("*").single()));
  }

  async revoke(workspaceId: string, id: string): Promise<ApiKey> {
    return toApiKey(must(await this.db.from("api_keys").update({ status: "revoked" }).eq("id", id).eq("workspace_id", workspaceId).select("*").single(), "API key not found."));
  }

  async revokeCreatedBy(workspaceId: string, userId: string): Promise<void> {
    await this.db.from("api_keys").update({ status: "revoked" }).eq("workspace_id", workspaceId).eq("created_by", userId).eq("status", "active");
  }

  async findByHash(hash: string): Promise<ApiKey | null> {
    const { data } = await this.db.from("api_keys").select("*").eq("key_hash", hash).maybeSingle();
    return data ? toApiKey(data) : null;
  }

  async touch(id: string, at: string): Promise<void> {
    await this.db.from("api_keys").update({ last_used_at: at }).eq("id", id);
  }
}

export class SupabaseAuditRepository extends SupabaseRepository implements AuditRepository {
  async insert(workspaceId: string, actor: Actor, e: Parameters<AuditRepository["insert"]>[2]): Promise<void> {
    await this.db.from("audit_events").insert({ workspace_id: workspaceId, actor, action: e.action, category: e.category, resource_type: e.resourceType, resource_id: e.resourceId, resource_name: e.resourceName, metadata: e.metadata });
  }

  async search(workspaceId: string, p: AuditQuery) {
    let q = this.db.from("audit_events").select("*", { count: "exact" }).eq("workspace_id", workspaceId);
    if (p.category) q = q.eq("category", p.category);
    if (p.actorId) q = q.eq("actor->>id", p.actorId);
    if (p.from) q = q.gte("created_at", p.from);
    if (p.to) q = q.lte("created_at", p.to);
    if (p.search) q = q.or(`action.ilike.%${p.search}%,resource_name.ilike.%${p.search}%,actor->>name.ilike.%${p.search}%`);
    const { data, count } = await q.order("created_at", { ascending: p.ascending }).range(p.offset, p.offset + p.limit - 1);
    return { rows: (data ?? []).map(toAudit), count: count ?? 0 };
  }

  async recentActors(workspaceId: string, limit: number): Promise<Actor[]> {
    const { data } = await this.db.from("audit_events").select("actor").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
    return (data ?? []).map((r) => r.actor as Actor);
  }

  async recent(workspaceId: string, limit: number): Promise<AuditEvent[]> {
    const { data } = await this.db.from("audit_events").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
    return (data ?? []).map(toAudit);
  }
}

export class SupabaseNotificationRepository extends SupabaseRepository implements NotificationRepository {
  async insert(n: Pick<AppNotification, "workspaceId" | "kind" | "title" | "body" | "href">): Promise<string | null> {
    const { data, error } = await this.db.from("notifications").insert({ workspace_id: n.workspaceId, kind: n.kind, title: n.title, body: n.body, href: n.href }).select("id").single();
    if (error || !data) {
      console.error("[brightrail] couldn't create notification", error?.message);
      return null;
    }
    return data.id as string;
  }

  async findById(id: string): Promise<AppNotification | null> {
    const { data } = await this.db.from("notifications").select("*").eq("id", id).maybeSingle();
    return data ? toNotification(data) : null;
  }

  async recent(workspaceId: string, limit: number): Promise<AppNotification[]> {
    const { data } = await this.db.from("notifications").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
    return (data ?? []).map(toNotification);
  }

  async readIds(userId: string, ids: string[]): Promise<Set<string>> {
    const { data } = await this.db.from("notification_reads").select("notification_id").eq("user_id", userId).in("notification_id", ids);
    return new Set((data ?? []).map((r) => r.notification_id as string));
  }

  async unreadCount(workspaceId: string, userId: string, since: string): Promise<number> {
    const { data, error } = await this.db.rpc("unread_notification_count", { p_ws: workspaceId, p_user: userId, p_since: since });
    if (error) console.error("[brightrail] unread count failed — did you run 0002_live_limits_reads.sql?", error.message);
    return typeof data === "number" ? data : 0;
  }

  async markAllRead(workspaceId: string, userId: string): Promise<void> {
    const { error } = await this.db.rpc("mark_all_notifications_read", { p_ws: workspaceId, p_user: userId });
    if (error) throw new ApiError("INTERNAL", "Couldn't mark notifications as read.");
  }

  async idsInWorkspace(workspaceId: string, ids: string[]): Promise<string[]> {
    const { data } = await this.db.from("notifications").select("id").eq("workspace_id", workspaceId).in("id", ids);
    return (data ?? []).map((n) => n.id as string);
  }

  async markRead(workspaceId: string, userId: string, ids: string[]): Promise<void> {
    const rows = ids.map((id) => ({ notification_id: id, user_id: userId, workspace_id: workspaceId }));
    const { error } = await this.db.from("notification_reads").upsert(rows, { onConflict: "notification_id,user_id", ignoreDuplicates: true });
    if (error) throw new ApiError("INTERNAL", "Couldn't mark notifications as read.");
  }
}

/** Counters kept by Postgres functions (0002 / 0008). */
export class SupabaseRateLimiter extends SupabaseRepository implements RateLimiter {
  async hit(key: string, windowSec: number) {
    const { data, error } = await this.db.rpc("rate_hit", { p_key: key, p_window_sec: windowSec });
    return error ? { count: null, error: error.message } : { count: typeof data === "number" ? data : null };
  }

  async webhookHit(endpointId: string) {
    const { data, error } = await this.db.rpc("webhook_rate_hit", { p_endpoint: endpointId });
    return error ? { count: null, error: error.message } : { count: typeof data === "number" ? data : null };
  }
}
