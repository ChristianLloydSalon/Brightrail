"use server";

import type { ApprovalStatus } from "@/lib/domain/types";
import type { RunListParams } from "../application/runs/run-service";
import { inWorkspace } from "../presentation/action";

export type { RunDetail, RunListItem, RunListParams, RunSortKey } from "../application/runs/run-service";

/* ---------------- runs ---------------- */

export async function list(params: RunListParams = {}) {
  return inWorkspace("runs.view", (app, ctx) => app.runs.list(ctx, params));
}

export async function get(id: string) {
  return inWorkspace("runs.view", (app, ctx) => app.runs.get(ctx, id));
}

export async function retryStep(runId: string, stepId: string) {
  return inWorkspace("runs.retry", (app, ctx) => app.runs.retryStep(ctx, runId, stepId));
}

export async function cancel(runId: string, reason: string) {
  return inWorkspace("runs.cancel", (app, ctx) => app.runs.cancel(ctx, runId, reason));
}

export async function rerun(runId: string) {
  return inWorkspace("runs.trigger", (app, ctx) => app.runs.rerun(ctx, runId));
}

/* ---------------- AI exception assistant & approvals ---------------- */

export async function analyze(runId: string) {
  return inWorkspace("runs.view", (app, ctx) => app.approvals.analyze(ctx, runId));
}

export async function requestApproval(analysisId: string) {
  return inWorkspace("runs.trigger", (app, ctx) => app.approvals.request(ctx, analysisId));
}

export async function listApprovals(status: ApprovalStatus | "all" = "all") {
  return inWorkspace("runs.view", (app, ctx) => app.approvals.list(ctx, status));
}

/** Permissions and resource state are re-checked at decision time (spec §08 step 6). */
export async function decide(id: string, decision: "approve" | "reject", reason: string) {
  return inWorkspace("approvals.decide", (app, ctx) => app.approvals.decide(ctx, id, decision, reason));
}
