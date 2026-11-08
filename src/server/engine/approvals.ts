import "server-only";
import { adminClient } from "../supabase";
import { inngest } from "./client";

/**
 * Approval expiry. Each request gets a timer that fires at its expiry time; an hourly sweep catches
 * anything a lost timer missed (e.g. a restarted local Inngest dev server). Expiring is atomic: only
 * a request that is still pending and past its deadline changes, so it can't race a decision.
 */
export const APPROVAL_REQUESTED = "approval/requested";

type Row = { id: string; workspace_id: string; run_id: string; workflow_name: string; step_id: string };

export async function expireApproval(id: string): Promise<boolean> {
  const db = adminClient();
  const now = new Date().toISOString();
  const { data } = await db.from("approval_requests").update({ status: "expired", decided_at: now }).eq("id", id).eq("status", "pending").lte("expires_at", now).select("id, workspace_id, run_id, workflow_name, step_id");
  const row = (data?.[0] ?? null) as Row | null;
  if (!row) return false;
  const { data: run } = await db.from("workflow_runs").select("status, logs").eq("id", row.run_id).maybeSingle();
  if (run?.status === "waiting_approval") {
    const entry = { id: `log_${Date.now().toString(36)}`, ts: now, level: "warn", message: "The approval request expired without a decision. Run returned to failed; ask the assistant for a new recommendation to try again." };
    await db.from("workflow_runs").update({ status: "failed", logs: [...((run.logs as unknown[]) ?? []), entry] }).eq("id", row.run_id).eq("status", "waiting_approval");
  }
  await db.from("audit_events").insert({ workspace_id: row.workspace_id, actor: { type: "service", id: "system", name: "Brightrail" }, action: "approval.expired", category: "approval", resource_type: "approval_request", resource_id: row.id, resource_name: row.workflow_name, metadata: { runId: row.run_id } });
  return true;
}

/** Arms the expiry timer. Never fails the caller; the hourly sweep is the safety net. */
export async function scheduleApprovalExpiry(approvalId: string, expiresAt: string) {
  try {
    await inngest.send({ id: `approval-${approvalId}`, name: APPROVAL_REQUESTED, data: { approvalId, expiresAt } });
  } catch (e) {
    console.error("[brightrail] couldn't schedule approval expiry; the hourly sweep will handle it", (e as Error).message);
  }
}

export const approvalExpiryFunction = inngest.createFunction(
  { id: "approval-expiry", name: "Expire approval request", retries: 3, triggers: [{ event: APPROVAL_REQUESTED }] },
  async ({ event, step }) => {
    const { approvalId, expiresAt } = event.data as { approvalId: string; expiresAt: string };
    await step.sleepUntil("wait-for-expiry", new Date(new Date(expiresAt).getTime() + 1000));
    return step.run("expire", async () => ({ expired: await expireApproval(approvalId) }));
  },
);

export const approvalSweepFunction = inngest.createFunction(
  { id: "approval-expiry-sweep", name: "Expire overdue approvals", triggers: [{ cron: "TZ=UTC 23 * * * *" }] },
  async ({ step }) =>
    step.run("sweep", async () => {
      const { data } = await adminClient().from("approval_requests").select("id").eq("status", "pending").lte("expires_at", new Date().toISOString()).limit(500);
      let n = 0;
      for (const r of data ?? []) if (await expireApproval(r.id)) n++;
      return { expired: n };
    }),
);
