import "server-only";
import { UNIT_SECONDS } from "@/lib/domain/nodes";
import { createWalker } from "@/lib/engine/walk";
import type { AttemptResult } from "@/server/application/engine/run-engine";
import type { ScheduleTick } from "@/server/application/ports/services";
import { container } from "@/server/container";
import { sendNotificationEmail } from "../email/notification-email";
import { inngest } from "./client";
import { EVENTS, tickEventId } from "./event-bus";

/**
 * Inngest adapters. Each function only orchestrates durable steps (memoized results, timers, fan-out);
 * the work inside every step is an application service call, so it can be tested without Inngest.
 */

/** The durable workflow. Each attempt, timer and backoff is a memoized step; the order comes from lib/engine/walk.ts. */
export const runWorkflowFunction = inngest.createFunction(
  {
    id: "run-workflow",
    retries: 0,
    triggers: [{ event: EVENTS.runRequested }],
    cancelOn: [{ event: EVENTS.runCancelled, if: "event.data.runId == async.data.runId" }],
    concurrency: [{ key: "event.data.runId", limit: 1 }],
  },
  async ({ event, step }) => {
    const engine = container().runEngine;
    const { runId, pass = 0, resumeFromNodeId } = event.data as { runId: string; pass?: number; resumeFromNodeId?: string };
    const p = `p${pass}`;
    const def = await step.run(`${p}:load`, () => engine.definition(runId));

    const walker = createWalker(def, {
      exec: async (node, sid) => {
        const id = node.id;
        if (node.kind === "delay") {
          await step.run(`${sid}:start`, () => engine.markDelayStart(runId, id));
          await step.sleep(`${sid}:timer`, `${Math.max(1, node.config.amount * UNIT_SECONDS[node.config.unit])}s`);
          return step.run(`${sid}:a1`, () => engine.attempt(runId, id, 1));
        }
        // An approved/manual retry of a failed step gets exactly one more attempt.
        const isResume = resumeFromNodeId === id && pass > 0;
        const max = isResume ? 1 : node.kind === "http" || node.kind === "action" ? Math.max(1, node.config.maxAttempts) : 1;
        let result: AttemptResult = { ok: false };
        for (let a = 1; a <= max; a++) {
          result = await step.run(`${sid}:a${a}`, () => engine.attempt(runId, id, isResume ? 0 : max));
          if (result.cancelled || result.ok || !result.retryInSec) break;
          await step.sleep(`${sid}:backoff${a}`, `${result.retryInSec}s`);
        }
        return result;
      },
      fail: (node, sid) => step.run(`${sid}:fail`, () => engine.fail(runId, node.id)),
      loopBegin: async (node, sid) => (await step.run(`${sid}:begin`, () => engine.beginLoop(runId, node.id))).count,
      loopItem: async (node, i, sid, bodyIds) => { await step.run(`${sid}:set`, () => engine.beginIteration(runId, node.id, i, bodyIds)); },
      loopEnd: async (node, sid) => { await step.run(`${sid}:end`, () => engine.endLoop(runId, node.id)); },
    });

    // Retrying a step inside a loop restarts the outermost loop around it (per-item idempotency keys
    // stop external effects from repeating within the provider's window).
    const trigger = def.nodes.find((n) => n.kind === "trigger");
    const start = resumeFromNodeId ? walker.resumePoint(resumeFromNodeId) : trigger?.id;
    const outcome = await walker.walk(start ? [start] : [], `${p}:`, null);
    if (outcome === "cancelled") return { status: "cancelled" };
    if (outcome === "failed") return { status: "failed" };
    await step.run(`${p}:finish`, () => engine.finish(runId));
    return { status: "succeeded" };
  },
);

export const scheduleTickFunction = inngest.createFunction(
  { id: "workflow-schedule-tick", name: "Scheduled workflow tick", retries: 3, triggers: [{ event: EVENTS.scheduleTick }] },
  async ({ event, step }) => {
    const t = event.data as ScheduleTick;
    await step.sleepUntil("wait-for-slot", new Date(t.at));
    const fired = await step.run("claim-and-start", () => container().schedules.fire(t));
    if ("next" in fired && fired.next) {
      const next = { workflowId: t.workflowId, version: t.version, at: fired.next };
      await step.sendEvent("schedule-next", { id: tickEventId(next), name: EVENTS.scheduleTick, data: next });
    }
    return fired;
  },
);

export const scheduleReconcileFunction = inngest.createFunction(
  { id: "workflow-schedule-reconcile", name: "Re-arm schedules", triggers: [{ cron: "TZ=UTC 7 * * * *" }] },
  async ({ step }) => step.run("rearm", () => container().schedules.reconcile()),
);

export const approvalExpiryFunction = inngest.createFunction(
  { id: "approval-expiry", name: "Expire approval request", retries: 3, triggers: [{ event: EVENTS.approvalRequested }] },
  async ({ event, step }) => {
    const { approvalId, expiresAt } = event.data as { approvalId: string; expiresAt: string };
    await step.sleepUntil("wait-for-expiry", new Date(new Date(expiresAt).getTime() + 1000));
    return step.run("expire", async () => ({ expired: await container().approvalExpiry.expire(approvalId) }));
  },
);

export const approvalSweepFunction = inngest.createFunction(
  { id: "approval-expiry-sweep", name: "Expire overdue approvals", triggers: [{ cron: "TZ=UTC 23 * * * *" }] },
  async ({ step }) => step.run("sweep", async () => ({ expired: await container().approvalExpiry.sweep() })),
);

/**
 * Daily clean-up (03:30 UTC): deletes finished runs older than each workspace's retention setting,
 * together with their step data, logs, AI analyses and approvals (cascade), plus old webhook delivery
 * records and notifications. The audit log is append-only and is never purged.
 */
export const retentionFunction = inngest.createFunction(
  { id: "purge-expired-runs", name: "Run history retention", triggers: [{ cron: "TZ=UTC 30 3 * * *" }] },
  async ({ step }) => {
    let total = 0;
    // Batches of up to 5,000 runs keep each statement short.
    for (let i = 0; i < 20; i++) {
      const n = await step.run(`purge-${i}`, () => container().repos.runs.purgeExpired());
      total += n;
      if (n < 5000) break;
    }
    return { deletedRuns: total };
  },
);

/** Emails each opted-in, permitted, active member. One step per recipient so retries never double-send. */
export const notificationEmailFunction = inngest.createFunction(
  { id: "notification-email", name: "Email notifications", retries: 3, triggers: [{ event: EVENTS.notificationCreated }] },
  async ({ event, step }) => {
    const { notificationId } = event.data as { notificationId: string };
    const plan = await step.run("recipients", () => container().notifications.emailPlan(notificationId));
    if (!plan) return { sent: 0 };
    let sent = 0;
    for (const r of plan.to) {
      await step.run(`email-${r.userId}`, () => sendNotificationEmail(plan, r, `notif-${notificationId}-${r.userId}`));
      sent++;
    }
    return { sent };
  },
);

export const allFunctions = [runWorkflowFunction, scheduleTickFunction, scheduleReconcileFunction, retentionFunction, notificationEmailFunction, approvalExpiryFunction, approvalSweepFunction];
