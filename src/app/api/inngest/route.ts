import { serve } from "inngest/next";
import { approvalExpiryFunction, approvalSweepFunction } from "@/server/engine/approvals";
import { retentionFunction } from "@/server/engine/maintenance";
import { inngest, runWorkflowFunction } from "@/server/engine/runs";
import { scheduleReconcileFunction, scheduleTickFunction } from "@/server/engine/schedules";
import { notificationEmailFunction } from "@/server/notifications";

// Inngest calls this endpoint to execute workflow steps. Signed with INNGEST_SIGNING_KEY in production.
export const { GET, POST, PUT } = serve({ client: inngest, functions: [runWorkflowFunction, scheduleTickFunction, scheduleReconcileFunction, retentionFunction, notificationEmailFunction, approvalExpiryFunction, approvalSweepFunction] });
export const maxDuration = 60;
