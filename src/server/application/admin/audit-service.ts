import type { Page } from "@/lib/api-error";
import type { AuditCategory, AuditEvent } from "@/lib/domain/types";
import type { AuditRepository } from "../ports/repositories";
import type { RequestContext } from "../shared/context";
import { dayEnd, dayStart, offsetOf, pageOf } from "../shared/paging";

export interface AuditParams { search?: string; category?: AuditCategory | "all"; actorId?: string | "all"; from?: string; to?: string; page?: number; pageSize?: number; dir?: "asc" | "desc" }

/** Read side of the append-only audit log. */
export class AuditService {
  constructor(private readonly audit: AuditRepository) {}

  async list(ctx: RequestContext, params: AuditParams = {}): Promise<Page<AuditEvent>> {
    const pageSize = params.pageSize ?? 20;
    const page = Math.max(1, params.page ?? 1);
    const { rows, count } = await this.audit.search(ctx.workspaceId, {
      category: params.category && params.category !== "all" ? params.category : undefined,
      actorId: params.actorId && params.actorId !== "all" ? params.actorId : undefined,
      from: params.from ? dayStart(params.from) : undefined,
      to: params.to ? dayEnd(params.to) : undefined,
      // Characters that would change the PostgREST filter grammar are dropped.
      search: params.search?.trim().replace(/[%_,()]/g, "") || undefined,
      ascending: params.dir === "asc",
      offset: offsetOf(page, pageSize),
      limit: pageSize,
    });
    return pageOf(rows, count, page, pageSize);
  }

  async actors(ctx: RequestContext) {
    const map = new Map<string, { id: string; name: string; type: string }>();
    for (const a of await this.audit.recentActors(ctx.workspaceId, 1000)) map.set(a.id, a);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
