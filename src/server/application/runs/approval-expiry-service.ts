import type { ApprovalRepository, RunRepository } from "../ports/repositories";
import type { EventBus } from "../ports/services";
import { type AuditLog, SYSTEM_ACTOR } from "../shared/audit-log";

/**
 * Approval expiry. Each request gets a timer that fires at its expiry time; an hourly sweep catches
 * anything a lost timer missed (e.g. a restarted local Inngest dev server). Expiring is atomic: only a
 * request that is still pending and past its deadline changes, so it can't race a decision.
 */
export class ApprovalExpiryService {
  constructor(
    private readonly approvals: ApprovalRepository,
    private readonly runs: RunRepository,
    private readonly bus: EventBus,
    private readonly audit: AuditLog,
  ) {}

  async expire(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const row = await this.approvals.expireIfDue(id, now);
    if (!row) return false;
    const run = await this.runs.findById(row.runId);
    if (run?.status === "waiting_approval") {
      const entry = { id: `log_${Date.now().toString(36)}`, ts: now, level: "warn" as const, message: "The approval request expired without a decision. Run returned to failed; ask the assistant for a new recommendation to try again." };
      await this.runs.updateIfStatus(row.runId, "waiting_approval", { status: "failed", logs: [...(run.logs ?? []), entry] });
    }
    await this.audit.recordFor(row.workspaceId, SYSTEM_ACTOR, { action: "approval.expired", category: "approval", resourceType: "approval_request", resourceId: row.id, resourceName: row.workflowName, metadata: { runId: row.runId } });
    return true;
  }

  /** Expires everything overdue (optionally in one workspace); returns how many changed. */
  async sweep(workspaceId?: string): Promise<number> {
    let n = 0;
    for (const id of await this.approvals.overdueIds(new Date().toISOString(), workspaceId, workspaceId ? undefined : 500)) if (await this.expire(id)) n++;
    return n;
  }

  /** Arms the expiry timer. Never fails the caller; the hourly sweep is the safety net. */
  async schedule(approvalId: string, expiresAt: string): Promise<void> {
    try {
      await this.bus.approvalRequested(approvalId, expiresAt);
    } catch (e) {
      console.error("[brightrail] couldn't schedule approval expiry; the hourly sweep will handle it", (e as Error).message);
    }
  }
}
