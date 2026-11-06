import "server-only";
import { adminClient } from "../supabase";
import { inngest } from "./client";

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
      const n = await step.run(`purge-${i}`, async () => {
        const { data, error } = await adminClient().rpc("purge_expired_runs");
        if (error) throw new Error(`purge_expired_runs failed: ${error.message}`);
        return Number(data ?? 0);
      });
      total += n;
      if (n < 5000) break;
    }
    return { deletedRuns: total };
  },
);
