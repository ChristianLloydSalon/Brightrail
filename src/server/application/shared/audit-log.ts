import type { AuditEvent } from "@/lib/domain/types";
import type { Actor, AuditRepository } from "../ports/repositories";
import type { RequestContext } from "./context";

export type AuditInput = Omit<AuditEvent, "id" | "workspaceId" | "createdAt" | "actor"> & { actor?: Actor };

export const WORKER_ACTOR: Actor = { type: "service", id: "svc_worker", name: "Workflow worker" };
export const SYSTEM_ACTOR: Actor = { type: "service", id: "system", name: "Brightrail" };

/** Append-only audit trail. Defaults the actor to the signed-in person. */
export class AuditLog {
  constructor(private readonly repo: AuditRepository) {}

  record(ctx: RequestContext, e: AuditInput): Promise<void> {
    return this.recordFor(ctx.workspaceId, e.actor ?? ctx.actor, e);
  }

  recordFor(workspaceId: string, actor: Actor, e: Omit<AuditInput, "actor">): Promise<void> {
    return this.repo.insert(workspaceId, actor, { action: e.action, category: e.category, resourceType: e.resourceType, resourceId: e.resourceId, resourceName: e.resourceName, metadata: e.metadata });
  }
}
