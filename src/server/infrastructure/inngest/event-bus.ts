import "server-only";
import type { EventBus, ScheduleTick } from "@/server/application/ports/services";
import { inngest } from "./client";

export const EVENTS = {
  runRequested: "workflow/run.requested",
  runCancelled: "workflow/run.cancelled",
  approvalRequested: "approval/requested",
  scheduleTick: "workflow/schedule.tick",
  notificationCreated: "notification/created",
} as const;

/** Same workflow + slot → same event id → Inngest drops the duplicate. */
export const tickEventId = (t: ScheduleTick) => `sched-${t.workflowId}-${t.version}-${t.at}`;

/** EventBus on Inngest. Deterministic event ids make repeated sends no-ops. */
export class InngestEventBus implements EventBus {
  async requestRun(data: { runId: string; pass: number; resumeFromNodeId?: string }, id?: string) {
    await inngest.send({ ...(id ? { id } : {}), name: EVENTS.runRequested, data });
  }

  async cancelRun(runId: string) {
    await inngest.send({ name: EVENTS.runCancelled, data: { runId } });
  }

  async approvalRequested(approvalId: string, expiresAt: string) {
    await inngest.send({ id: `approval-${approvalId}`, name: EVENTS.approvalRequested, data: { approvalId, expiresAt } });
  }

  async scheduleTick(t: ScheduleTick) {
    await inngest.send({ id: tickEventId(t), name: EVENTS.scheduleTick, data: t });
  }

  async notificationCreated(notificationId: string) {
    await inngest.send({ id: `notif-${notificationId}`, name: EVENTS.notificationCreated, data: { notificationId } });
  }
}
