import "server-only";
import type { WorkflowDefinition } from "@/lib/domain/types";
import { checkSchedule, describeSchedule, nextRunAfter, onceAt } from "@/lib/engine/schedule";
import { adminClient } from "../supabase";
import { inngest } from "./client";
import { startRun } from "./runs";

/**
 * Schedule trigger.
 *
 * Each active schedule has one pending Inngest "tick" that sleeps until `next_run_at`. When it wakes,
 * it atomically claims that slot in Postgres (so duplicates can't double-run), starts the run, stores the
 * following slot and sends the next tick. Changing, pausing or archiving the workflow bumps `version`,
 * which makes any older pending tick exit without doing anything. An hourly reconcile job re-sends ticks
 * that were lost (e.g. the local Inngest dev server was restarted) and catches up missed slots.
 */
export const SCHEDULE_TICK = "workflow/schedule.tick";

type Tick = { workflowId: string; version: number; at: string };

async function sendTick(t: Tick) {
  // Same workflow + slot → same event id → Inngest drops the duplicate.
  await inngest.send({ id: `sched-${t.workflowId}-${t.version}-${t.at}`, name: SCHEDULE_TICK, data: t });
}

/** Call after anything that can change whether/when a workflow runs on a schedule. */
export async function syncSchedule(workflowId: string): Promise<{ nextRunAt: string | null; description?: string }> {
  const db = adminClient();
  const { data: wf } = await db.from("workflows").select("id, workspace_id, status, current_version_id").eq("id", workflowId).maybeSingle();
  const { data: existing } = await db.from("workflow_schedules").select("version").eq("workflow_id", workflowId).maybeSingle();
  let trigger: { config: { triggerType: string; schedule?: Parameters<typeof checkSchedule>[0] } } | undefined;
  if (wf?.current_version_id) {
    const { data: ver } = await db.from("workflow_versions").select("definition").eq("id", wf.current_version_id).single();
    trigger = (ver?.definition as WorkflowDefinition | undefined)?.nodes.find((n) => n.kind === "trigger") as typeof trigger;
  }
  const spec = trigger?.config.triggerType === "schedule" ? trigger.config.schedule : undefined;
  const checked = spec ? checkSchedule(spec) : undefined;
  const version = (existing?.version ?? 0) + 1;

  if (!wf || wf.status !== "active" || !spec || !checked?.cron) {
    if (existing) await db.from("workflow_schedules").update({ enabled: false, version, next_run_at: null, updated_at: new Date().toISOString() }).eq("workflow_id", workflowId);
    return { nextRunAt: null };
  }
  const once = spec.mode === "once";
  const at = once ? onceAt(spec) : null;
  if (at && "error" in at) {
    // e.g. the one-time date has already passed: keep the row for history but don't arm it.
    if (existing) await db.from("workflow_schedules").update({ enabled: false, version, next_run_at: null, last_error: at.error, updated_at: new Date().toISOString() }).eq("workflow_id", workflowId);
    return { nextRunAt: null };
  }
  const next = (at ? at.at : nextRunAfter(checked.cron, spec.timezone, new Date())).toISOString();
  const row = { workflow_id: wf.id, workspace_id: wf.workspace_id, cron: checked.cron, timezone: spec.timezone, description: describeSchedule(spec), run_once: once, enabled: true, version, next_run_at: next, last_error: null, updated_at: new Date().toISOString() };
  const { error } = await db.from("workflow_schedules").upsert(row, { onConflict: "workflow_id" });
  if (error) throw new Error(`Couldn't save the schedule: ${error.message}`);
  await sendTick({ workflowId: wf.id, version, at: next });
  return { nextRunAt: next, description: row.description };
}

export const scheduleTickFunction = inngest.createFunction(
  { id: "workflow-schedule-tick", name: "Scheduled workflow tick", retries: 3, triggers: [{ event: SCHEDULE_TICK }] },
  async ({ event, step }) => {
    const t = event.data as Tick;
    await step.sleepUntil("wait-for-slot", new Date(t.at));

    const fired = await step.run("claim-and-start", async () => {
      const db = adminClient();
      const { data: s } = await db.from("workflow_schedules").select("*").eq("workflow_id", t.workflowId).maybeSingle();
      if (!s || !s.enabled || s.version !== t.version || new Date(s.next_run_at).getTime() !== new Date(t.at).getTime()) return { skipped: "stale" as const };
      // One-time schedules switch themselves off after this slot.
      const next = s.run_once ? null : nextRunAfter(s.cron, s.timezone, new Date(Math.max(Date.now(), new Date(t.at).getTime()))).toISOString();
      // Atomic claim: only one tick can move next_run_at forward from this slot.
      const { data: claimed } = await db
        .from("workflow_schedules")
        .update({ next_run_at: next, ...(s.run_once ? { enabled: false } : {}), last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("workflow_id", t.workflowId).eq("version", t.version).eq("next_run_at", s.next_run_at)
        .select("workflow_id");
      if (!claimed?.length) return { skipped: "claimed" as const };

      let runId: string | null = null;
      let error: string | null = null;
      try {
        const { data: wf } = await db.from("workflows").select("id, name, status, current_version_id").eq("id", t.workflowId).single();
        const run = await startRun({ workspaceId: s.workspace_id, workflow: wf!, input: { scheduledFor: t.at }, trigger: { source: "schedule", detail: s.description } });
        runId = run.id;
      } catch (e) {
        error = (e as Error).message; // e.g. monthly quota reached — skip this slot, keep the schedule
      }
      await db.from("workflow_schedules").update({ last_run_id: runId, last_error: error }).eq("workflow_id", t.workflowId);
      return { next, runId, error };
    });

    if ("next" in fired && fired.next) await step.sendEvent("schedule-next", { id: `sched-${t.workflowId}-${t.version}-${fired.next}`, name: SCHEDULE_TICK, data: { workflowId: t.workflowId, version: t.version, at: fired.next } });
    return fired;
  },
);

/** Hourly: re-arm ticks due within the next 70 minutes (duplicates are dropped by event id) and catch up missed slots. */
export const scheduleReconcileFunction = inngest.createFunction(
  { id: "workflow-schedule-reconcile", name: "Re-arm schedules", triggers: [{ cron: "TZ=UTC 7 * * * *" }] },
  async ({ step }) => {
    return step.run("rearm", async () => {
      const db = adminClient();
      const horizon = new Date(Date.now() + 70 * 60_000).toISOString();
      const { data: rows } = await db.from("workflow_schedules").select("workflow_id, version, cron, timezone, next_run_at, run_once").eq("enabled", true).lte("next_run_at", horizon);
      let rearmed = 0;
      for (const r of rows ?? []) {
        let at = r.next_run_at as string;
        if (new Date(at).getTime() < Date.now() - 2 * 60_000 && r.run_once) {
          await db.from("workflow_schedules").update({ enabled: false, next_run_at: null, last_error: "The one-time run was missed because the worker was unavailable at that time. Set a new date and publish again." }).eq("workflow_id", r.workflow_id).eq("version", r.version);
          continue;
        }
        if (new Date(at).getTime() < Date.now() - 2 * 60_000) {
          // Missed while the worker was down: skip ahead to the next future slot (no burst of catch-up runs).
          at = nextRunAfter(r.cron, r.timezone, new Date()).toISOString();
          const { data: moved } = await db.from("workflow_schedules").update({ next_run_at: at, last_error: "Missed a slot while the worker was unavailable; skipped to the next one." }).eq("workflow_id", r.workflow_id).eq("version", r.version).eq("next_run_at", r.next_run_at).select("workflow_id");
          if (!moved?.length) continue;
        }
        await sendTick({ workflowId: r.workflow_id, version: r.version, at });
        rearmed++;
      }
      return { rearmed };
    });
  },
);
