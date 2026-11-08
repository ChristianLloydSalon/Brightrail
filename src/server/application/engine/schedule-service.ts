import type { TriggerConfig } from "@/lib/domain/types";
import { checkSchedule, describeSchedule, nextRunAfter, onceAt } from "@/lib/engine/schedule";
import type { RunLauncher } from "../runs/run-launcher";
import type { ScheduleRepository, VersionRepository, WorkflowRepository } from "../ports/repositories";
import type { EventBus, ScheduleTick } from "../ports/services";

export type TickOutcome = { skipped: "stale" | "claimed" } | { next: string | null; runId: string | null; error: string | null };

/**
 * Schedule trigger.
 *
 * Each active schedule has one pending tick that sleeps until `next_run_at`. When it wakes, it atomically
 * claims that slot in Postgres (so duplicates can't double-run), starts the run, stores the following slot
 * and sends the next tick. Changing, pausing or archiving the workflow bumps `version`, which makes any
 * older pending tick exit without doing anything. An hourly reconcile re-sends ticks that were lost (e.g.
 * the local Inngest dev server was restarted) and catches up missed slots.
 */
export class ScheduleService {
  constructor(
    private readonly schedules: ScheduleRepository,
    private readonly workflows: WorkflowRepository,
    private readonly versions: VersionRepository,
    private readonly launcher: RunLauncher,
    private readonly bus: EventBus,
  ) {}

  /** Call after anything that can change whether or when a workflow runs on a schedule. */
  async sync(workflowId: string): Promise<{ nextRunAt: string | null; description?: string }> {
    const wf = await this.workflows.findById(workflowId);
    const existing = await this.schedules.findByWorkflow(workflowId);
    let trigger: { config: TriggerConfig } | undefined;
    if (wf?.currentVersionId) {
      const def = await this.versions.definitionOf(wf.currentVersionId);
      trigger = def?.nodes.find((n) => n.kind === "trigger") as typeof trigger;
    }
    const spec = trigger?.config.triggerType === "schedule" ? trigger.config.schedule : undefined;
    const checked = spec ? checkSchedule(spec) : undefined;
    const version = (existing?.version ?? 0) + 1;

    if (!wf || wf.status !== "active" || !spec || !checked?.cron) {
      if (existing) await this.schedules.disable(workflowId, version);
      return { nextRunAt: null };
    }
    const once = spec.mode === "once";
    const at = once ? onceAt(spec) : null;
    if (at && "error" in at) {
      // e.g. the one-time date has already passed: keep the row for history but don't arm it.
      if (existing) await this.schedules.disable(workflowId, version, at.error);
      return { nextRunAt: null };
    }
    const next = (at ? at.at : nextRunAfter(checked.cron, spec.timezone, new Date())).toISOString();
    const description = describeSchedule(spec);
    await this.schedules.upsert({ workflowId: wf.id, workspaceId: wf.workspaceId, cron: checked.cron, timezone: spec.timezone, description, runOnce: once, enabled: true, version, nextRunAt: next, lastError: null });
    await this.bus.scheduleTick({ workflowId: wf.id, version, at: next });
    return { nextRunAt: next, description };
  }

  /** (Re)arms or disarms the schedule. Never fails the caller: the hourly reconcile re-arms anything missed. */
  async syncQuietly(workflowId: string): Promise<void> {
    try {
      await this.sync(workflowId);
    } catch (e) {
      console.error("[brightrail] schedule sync failed; the hourly reconcile will retry", (e as Error).message);
    }
  }

  /** The tick woke up at its slot: claim it, start the run, and report the following slot. */
  async fire(t: ScheduleTick): Promise<TickOutcome> {
    const s = await this.schedules.findByWorkflow(t.workflowId);
    if (!s || !s.enabled || s.version !== t.version || !s.nextRunAt || new Date(s.nextRunAt).getTime() !== new Date(t.at).getTime()) return { skipped: "stale" };
    // One-time schedules switch themselves off after this slot.
    const next = s.runOnce ? null : nextRunAfter(s.cron, s.timezone, new Date(Math.max(Date.now(), new Date(t.at).getTime()))).toISOString();
    if (!(await this.schedules.claimSlot(t.workflowId, t.version, s.nextRunAt, next, s.runOnce))) return { skipped: "claimed" };

    let runId: string | null = null;
    let error: string | null = null;
    try {
      const wf = await this.workflows.runnable(t.workflowId);
      const run = await this.launcher.start({ workspaceId: s.workspaceId, workflow: wf!, input: { scheduledFor: t.at }, trigger: { source: "schedule", detail: s.description } });
      runId = run.id;
    } catch (e) {
      error = (e as Error).message; // e.g. monthly quota reached — skip this slot, keep the schedule
    }
    await this.schedules.recordOutcome(t.workflowId, runId, error);
    return { next, runId, error };
  }

  /** Re-arm ticks due within the next 70 minutes (duplicates are dropped by event id) and catch up missed slots. */
  async reconcile(): Promise<{ rearmed: number }> {
    const horizon = new Date(Date.now() + 70 * 60_000).toISOString();
    let rearmed = 0;
    for (const r of await this.schedules.dueBefore(horizon)) {
      let at = r.nextRunAt!;
      const missed = new Date(at).getTime() < Date.now() - 2 * 60_000;
      if (missed && r.runOnce) {
        await this.schedules.disableMissedOnce(r.workflowId, r.version, "The one-time run was missed because the worker was unavailable at that time. Set a new date and publish again.");
        continue;
      }
      if (missed) {
        // Missed while the worker was down: skip ahead to the next future slot (no burst of catch-up runs).
        at = nextRunAfter(r.cron, r.timezone, new Date()).toISOString();
        if (!(await this.schedules.moveSlot(r.workflowId, r.version, r.nextRunAt!, at, "Missed a slot while the worker was unavailable; skipped to the next one."))) continue;
      }
      await this.bus.scheduleTick({ workflowId: r.workflowId, version: r.version, at });
      rearmed++;
    }
    return { rearmed };
  }
}
