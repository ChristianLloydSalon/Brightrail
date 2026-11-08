"use server";

import { ApiError, type Page, type SortDir } from "@/lib/api-error";
import { checkPolicy } from "@/lib/ai/advisor";
import { CANCELLABLE_RUN_STATUSES } from "@/lib/domain/status";
import type { AiAnalysis, ApprovalRequest, ApprovalStatus, LogEntry, RunStatus, StepRun, TriggerSource, WorkflowDefinition, WorkflowNode, WorkflowRun } from "@/lib/domain/types";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import { uid } from "@/lib/utils";
import { analyzeWithAi } from "../ai";
import { createNotification } from "../notifications";
import { expireApproval, scheduleApprovalExpiry } from "../engine/approvals";
import { act, getContext, must, type RequestContext } from "../context";
import { inngest, RUN_CANCELLED, RUN_REQUESTED, startRun } from "../engine/runs";
import { toAnalysis, toApproval, toConnection, toRun } from "../rows";

export interface RunListItem {
  id: string; workflowId: string; workflowName: string; version: number; status: RunStatus; trigger: TriggerSource; triggerDetail: string;
  startedAt: string; endedAt?: string; durationMs: number | null; stepCount: number; failedStep?: string; errorCode?: string; hasOpenException: boolean;
}
export type RunSortKey = "startedAt" | "duration" | "workflow" | "status";
export interface RunListParams { search?: string; status?: RunStatus | "all"; workflowId?: string | "all"; trigger?: TriggerSource | "all"; from?: string; to?: string; sort?: RunSortKey; dir?: SortDir; page?: number; pageSize?: number }
export interface RunDetail { run: WorkflowRun; nodes: WorkflowNode[]; edges: WorkflowDefinition["edges"]; approvals: ApprovalRequest[]; analyses: AiAnalysis[]; workflowStatus: string }

const AI_ANALYSES_PER_HOUR = 60;

const log = (level: LogEntry["level"], message: string, stepId?: string): LogEntry => ({ id: uid("log", 8), ts: new Date().toISOString(), level, message, stepId });

async function findRun(ctx: RequestContext, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError("NOT_FOUND", "Run not found in this workspace.");
  return toRun(must(await ctx.db.from("workflow_runs").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Run not found in this workspace."));
}

export async function list(params: RunListParams = {}) {
  return act(async (): Promise<Page<RunListItem>> => {
    const ctx = await getContext("runs.view");
    const pageSize = params.pageSize ?? 15;
    const page = Math.max(1, params.page ?? 1);
    const sortCol = params.sort === "workflow" ? "workflow_name" : params.sort === "status" ? "status" : "started_at";
    let q = ctx.db.from("workflow_runs").select("id, workflow_id, workflow_name, version, status, trigger, started_at, ended_at, steps, exception", { count: "exact" }).eq("workspace_id", ctx.workspace.id);
    if (params.status && params.status !== "all") q = q.eq("status", params.status);
    if (params.workflowId && params.workflowId !== "all") q = q.eq("workflow_id", params.workflowId);
    if (params.trigger && params.trigger !== "all") q = q.eq("trigger->>source", params.trigger);
    if (params.from) q = q.gte("started_at", new Date(`${params.from}T00:00:00`).toISOString());
    if (params.to) q = q.lte("started_at", new Date(`${params.to}T23:59:59`).toISOString());
    const s = params.search?.trim();
    if (s) q = /^[0-9a-f-]{36}$/.test(s) ? q.eq("id", s) : q.ilike("workflow_name", `%${s.replace(/[%_]/g, "")}%`);
    q = q.order(sortCol, { ascending: params.dir === "asc" }).range((page - 1) * pageSize, page * pageSize - 1);
    const { data, count, error } = await q;
    if (error) throw new ApiError("INTERNAL", "Couldn't load runs.");
    let items: RunListItem[] = (data ?? []).map((r) => {
      const steps = (r.steps ?? []) as StepRun[];
      const failed = steps.find((x) => x.status === "failed");
      return {
        id: r.id, workflowId: r.workflow_id, workflowName: r.workflow_name, version: r.version, status: r.status, trigger: r.trigger.source, triggerDetail: r.trigger.detail,
        startedAt: r.started_at, endedAt: r.ended_at ?? undefined, durationMs: r.ended_at ? new Date(r.ended_at).getTime() - new Date(r.started_at).getTime() : null,
        stepCount: steps.filter((x) => x.status !== "skipped").length, failedStep: failed?.nodeLabel, errorCode: failed?.errorCode, hasOpenException: r.exception?.status === "open",
      };
    });
    if (params.sort === "duration") items = items.sort((a, b) => (params.dir === "asc" ? 1 : -1) * ((a.durationMs ?? 1e15) - (b.durationMs ?? 1e15)));
    const total = count ?? items.length;
    return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
  });
}

export async function get(id: string) {
  return act(async (): Promise<RunDetail> => {
    const ctx = await getContext("runs.view");
    const run = await findRun(ctx, id);
    const { data: ver } = await ctx.db.from("workflow_versions").select("definition").eq("id", run.workflowVersionId).single();
    const { data: aps } = await ctx.db.from("approval_requests").select("*").eq("run_id", id).order("requested_at", { ascending: false });
    const { data: ans } = await ctx.db.from("ai_analyses").select("*").eq("run_id", id).order("created_at", { ascending: false });
    const { data: wf } = await ctx.db.from("workflows").select("status").eq("id", run.workflowId).maybeSingle();
    const def = (ver?.definition ?? { nodes: [], edges: [] }) as WorkflowDefinition;
    return { run, nodes: def.nodes, edges: def.edges, approvals: (aps ?? []).map(toApproval), analyses: (ans ?? []).map(toAnalysis), workflowStatus: wf?.status ?? "archived" };
  });
}

/** Resumes a failed run from its failed step (one more attempt, same idempotency key). */
async function resume(ctx: RequestContext, run: WorkflowRun, stepId: string, actorLabel: string) {
  const steps = run.steps.map((s) => (s.id === stepId ? { ...s, status: "retrying" as const, endedAt: undefined } : s));
  const step = steps.find((s) => s.id === stepId)!;
  const { data: row } = await ctx.db.from("workflow_runs").select("pass, status").eq("id", run.id).single();
  const current = (row?.pass ?? 0) as number;
  const pass = current + 1;
  // Compare-and-set: only one concurrent retry/approval can move the run out of its current state and
  // claim the next pass; a second one finds no matching row and stops without dispatching.
  const { data: claimed } = await ctx.db
    .from("workflow_runs")
    .update({ status: "running", ended_at: null, pass, steps, logs: [...run.logs, log("info", `${actorLabel}: retrying “${step.nodeLabel}” once with the same idempotency key.`, stepId)] })
    .eq("id", run.id)
    .eq("workspace_id", ctx.workspace.id)
    .eq("pass", current)
    .eq("status", row?.status ?? run.status)
    .select("id");
  if (!claimed?.length) throw new ApiError("CONFLICT", "This run was just retried by someone else. Refresh to see its status.");
  // A deterministic event id makes a duplicate send for the same pass a no-op in Inngest.
  await inngest.send({ id: `${run.id}:p${pass}`, name: RUN_REQUESTED, data: { runId: run.id, pass, resumeFromNodeId: step.nodeId } });
}

export async function retryStep(runId: string, stepId: string) {
  return act(async () => {
    const ctx = await getContext("runs.retry");
    const run = await findRun(ctx, runId);
    if (run.status !== "failed") throw new ApiError("CONFLICT", run.status === "waiting_approval" ? "This run is waiting on an approval request. Decide it in Approvals." : "Only failed runs can be retried.");
    const step = run.steps.find((s) => s.id === stepId);
    if (!step || step.status !== "failed") throw new ApiError("CONFLICT", "Only the failed step can be retried.");
    if (step.errorClass === "permission" || step.errorClass === "validation")
      throw new ApiError("CONFLICT", step.errorClass === "permission" ? "Fix the connection first. Retrying with the same credential will fail again." : "This step failed validation. Retrying with the same input will fail again.");
    await resume(ctx, run, stepId, `Manual retry by ${ctx.user.name}`);
    await ctx.audit({ action: "run.step_retried", category: "run", resourceType: "workflow_run", resourceId: runId, resourceName: run.workflowName, metadata: { step: step.nodeLabel } });
    return { ok: true };
  });
}

export async function cancel(runId: string, reason: string) {
  return act(async () => {
    const ctx = await getContext("runs.cancel");
    const run = await findRun(ctx, runId);
    if (!CANCELLABLE_RUN_STATUSES.includes(run.status)) throw new ApiError("CONFLICT", "This run has already finished.");
    const now = ctx.now();
    const steps = run.steps.map((s) => (s.status === "running" || s.status === "retrying" || s.status === "pending" ? { ...s, status: "cancelled" as const, endedAt: s.status === "pending" ? undefined : now } : s));
    await ctx.db.from("workflow_runs").update({ status: "cancelled", ended_at: now, steps, logs: [...run.logs, log("warn", `Cancelled by ${ctx.user.name}. In-flight activities stop at the next step boundary.`)] }).eq("id", runId).eq("workspace_id", ctx.workspace.id);
    await ctx.db.from("approval_requests").update({ status: "expired", decision_reason: "Run was cancelled." }).eq("run_id", runId).eq("status", "pending");
    await inngest.send({ name: RUN_CANCELLED, data: { runId } }).catch(() => undefined);
    await ctx.audit({ action: "run.cancelled", category: "run", resourceType: "workflow_run", resourceId: runId, resourceName: run.workflowName, metadata: { reason: reason || "No reason given" } });
    return { ok: true };
  });
}

export async function rerun(runId: string) {
  return act(async () => {
    const ctx = await getContext("runs.trigger");
    const old = await findRun(ctx, runId);
    const { data: ctxRow } = await ctx.db.from("run_contexts").select("data").eq("run_id", runId).maybeSingle();
    const { data: wf } = await ctx.db.from("workflows").select("id, name, status, current_version_id").eq("id", old.workflowId).single();
    const input = ((ctxRow?.data as { trigger?: Record<string, unknown> } | null)?.trigger ?? {}) as Record<string, unknown>;
    const run = await startRun({ workspaceId: ctx.workspace.id, workflow: wf!, input, trigger: { source: "manual", actorId: ctx.user.id, detail: `Re-run of ${old.id.slice(0, 8)} by ${ctx.user.name}` } });
    await ctx.audit({ action: "run.triggered", category: "run", resourceType: "workflow_run", resourceId: run.id, resourceName: old.workflowName, metadata: { rerunOf: old.id } });
    return toRun(run);
  });
}

/* ---------------- AI exception assistant & approvals ---------------- */

export async function analyze(runId: string) {
  return act(async (): Promise<AiAnalysis> => {
    const ctx = await getContext("runs.view");
    if (!ctx.workspace.settings.aiAssistantEnabled) throw new ApiError("FORBIDDEN", "The AI assistant is turned off in workspace settings.");
    // Each analysis calls the operator-paid model, so cap it per workspace per hour.
    const { data: used, error: budgetErr } = await ctx.db.rpc("rate_hit", { p_key: `ai-analyze:${ctx.workspace.id}`, p_window_sec: 3600 });
    if (budgetErr) {
      console.error("[brightrail] AI analysis budget counter unavailable — run 0008_security_fixes.sql", budgetErr.message);
      if (process.env.NODE_ENV === "production") throw new ApiError("NOT_CONFIGURED", "The AI assistant is temporarily unavailable.");
    } else if (typeof used === "number" && used > AI_ANALYSES_PER_HOUR) throw new ApiError("RATE_LIMITED", `This workspace can run ${AI_ANALYSES_PER_HOUR} AI analyses per hour. Try again later.`);
    const run = await findRun(ctx, runId);
    const step = run.steps.find((s) => s.status === "failed");
    if (!step) throw new ApiError("CONFLICT", "There's no failed step to analyze in this run.");
    const { data: ver } = await ctx.db.from("workflow_versions").select("definition").eq("id", run.workflowVersionId).single();
    const node = (ver?.definition as WorkflowDefinition | undefined)?.nodes.find((n) => n.id === step.nodeId);
    const { data: conns } = await ctx.db.from("connections").select("*").eq("workspace_id", ctx.workspace.id);
    const out = await analyzeWithAi({ run, step, node, integrations: INTEGRATIONS, connections: (conns ?? []).map(toConnection), actor: { id: ctx.user.id, role: ctx.member.role }, grants: ctx.workspace.grants, aiEnabled: true });
    const row = must(await ctx.db.from("ai_analyses").insert({ workspace_id: ctx.workspace.id, run_id: runId, step_id: step.id, created_by: ctx.user.id, data: out }).select("*").single());
    await ctx.audit({ action: "ai.analysis_requested", category: "approval", resourceType: "workflow_run", resourceId: runId, resourceName: run.workflowName, metadata: { model: out.model, promptVersion: out.promptVersion, classification: out.classification } });
    return toAnalysis(row);
  });
}

export async function requestApproval(analysisId: string) {
  return act(async (): Promise<ApprovalRequest> => {
    const ctx = await getContext("runs.trigger");
    const a = toAnalysis(must(await ctx.db.from("ai_analyses").select("*").eq("id", analysisId).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Analysis not found."));
    const run = await findRun(ctx, a.runId);
    const step = run.steps.find((s) => s.id === a.stepId);
    if (!step) throw new ApiError("NOT_FOUND", "Step not found.");
    if ((a as AiAnalysis & { approvalRequestId?: string }).approvalRequestId) throw new ApiError("CONFLICT", "This recommendation was already sent for approval. Ask the assistant for a new one.");
    if (step.endedAt && a.createdAt < step.endedAt) throw new ApiError("CONFLICT", "This analysis is from an earlier failure of the step. Ask the assistant again.");
    // Same rule as a manual retry: retrying a permission or validation failure can't succeed.
    if (step.errorClass === "permission" || step.errorClass === "validation") throw new ApiError("CONFLICT", step.errorClass === "permission" ? "Fix the connection first. Retrying with the same credential will fail again." : "This step failed validation. Retrying with the same input will fail again.");
    const { data: pending } = await ctx.db.from("approval_requests").select("id").eq("run_id", run.id).eq("status", "pending");
    if (pending?.length) throw new ApiError("CONFLICT", "This run already has a pending approval request.");
    const policy = checkPolicy({ actionType: a.recommendation.actionType, actor: { role: ctx.member.role }, grants: ctx.workspace.grants, aiEnabled: ctx.workspace.settings.aiAssistantEnabled, run, step });
    if (!policy.allowed || !policy.requiresApproval) throw new ApiError("FORBIDDEN", policy.reasons[0] ?? "This recommendation can't be dispatched.");
    const inserted = await ctx.db.from("approval_requests").insert({
      workspace_id: ctx.workspace.id, run_id: run.id, step_id: step.id, workflow_name: run.workflowName, analysis_id: a.id, action_type: a.recommendation.actionType,
      tool_call: a.recommendation.toolCall, rationale: a.summary, requested_by: { type: "ai", id: "ai-assistant", name: `AI exception assistant (requested by ${ctx.user.name})` },
      expires_at: new Date(Date.now() + ctx.workspace.settings.approvalExpiryHours * 3600_000).toISOString(),
    }).select("*").single();
    // The unique pending-approval index (0008) turns a concurrent duplicate into a clean conflict.
    if (inserted.error?.code === "23505") throw new ApiError("CONFLICT", "This run already has a pending approval request.");
    const row = must(inserted);
    await ctx.db.from("ai_analyses").update({ data: { ...a, approvalRequestId: row.id } }).eq("id", a.id).eq("workspace_id", ctx.workspace.id);
    await ctx.db.from("workflow_runs").update({ status: "waiting_approval", logs: [...run.logs, log("info", `Approval request created for ${a.recommendation.toolCall.name}. Waiting for an authorized decision.`)] }).eq("id", run.id).eq("workspace_id", ctx.workspace.id);
    await scheduleApprovalExpiry(row.id, row.expires_at);
    await createNotification({ workspaceId: ctx.workspace.id, kind: "approval_requested", title: `Approval needed: retry “${step.nodeLabel}”`, body: run.workflowName, href: "/approvals" });
    await ctx.audit({ action: "approval.requested", category: "approval", resourceType: "approval_request", resourceId: row.id, resourceName: run.workflowName, actor: { type: "ai", id: "ai-assistant", name: "AI exception assistant" }, metadata: { actionType: a.recommendation.actionType, requestedFor: ctx.user.name } });
    return toApproval(row);
  });
}

export async function listApprovals(status: ApprovalStatus | "all" = "all") {
  return act(async (): Promise<ApprovalRequest[]> => {
    const ctx = await getContext("runs.view");
    // Background jobs expire requests on time; this catches any the worker hasn't reached yet.
    const { data: stale } = await ctx.db.from("approval_requests").select("id").eq("workspace_id", ctx.workspace.id).eq("status", "pending").lte("expires_at", ctx.now());
    for (const s of stale ?? []) await expireApproval(s.id);
    let q = ctx.db.from("approval_requests").select("*").eq("workspace_id", ctx.workspace.id).order("requested_at", { ascending: false }).limit(200);
    if (status !== "all") q = q.eq("status", status);
    const { data } = await q;
    return (data ?? []).map(toApproval);
  });
}

/** Permissions and resource state are re-checked at decision time (spec §08 step 6). */
export async function decide(id: string, decision: "approve" | "reject", reason: string) {
  return act(async (): Promise<ApprovalRequest> => {
    const ctx = await getContext("approvals.decide");
    const ap = toApproval(must(await ctx.db.from("approval_requests").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Approval request not found."));
    if (ap.status !== "pending") throw new ApiError("CONFLICT", `This request was already ${ap.status}.`);
    if (new Date(ap.expiresAt).getTime() < Date.now()) throw new ApiError("CONFLICT", "This request expired. Ask the assistant for a new recommendation.");
    if (decision === "reject" && reason.trim().length < 3) throw new ApiError("VALIDATION", "Add a reason.", { reason: "Add a short reason so the requester knows what to do next." });
    const run = await findRun(ctx, ap.runId);
    const now = ctx.now();
    if (decision === "approve") {
      const step = run.steps.find((s) => s.id === ap.stepId);
      if (!step || step.status !== "failed") throw new ApiError("CONFLICT", "The target step is no longer in a failed state.");
      // Re-check policy and resource state at decision time, not just when the request was made.
      const policy = checkPolicy({ actionType: ap.actionType, actor: { role: ctx.member.role }, grants: ctx.workspace.grants, aiEnabled: ctx.workspace.settings.aiAssistantEnabled, run, step });
      if (!policy.allowed) throw new ApiError("CONFLICT", policy.reasons.find((r) => !r.startsWith("Retries are consequential")) ?? "This action can no longer be dispatched.");
      const { data: wf } = await ctx.db.from("workflows").select("status").eq("id", run.workflowId).eq("workspace_id", ctx.workspace.id).maybeSingle();
      if (wf?.status !== "active") throw new ApiError("CONFLICT", "The workflow is paused or archived. Resume it before approving a retry.");
      // Conditional update: wins only if nobody else decided and it hasn't expired in the meantime.
      const { data: won } = await ctx.db.from("approval_requests").update({ status: "approved", decided_by: ctx.user.id, decided_by_name: ctx.user.name, decided_at: now, decision_reason: reason.trim() || null, outcome: "pending" }).eq("id", id).eq("workspace_id", ctx.workspace.id).eq("status", "pending").gt("expires_at", now).select("*");
      const row = won?.[0];
      if (!row) throw new ApiError("CONFLICT", "Someone else decided this request, or it just expired. Refresh to see its status.");
      await resume(ctx, run, ap.stepId, `Approved recovery by ${ctx.user.name}`);
      await ctx.audit({ action: "approval.approved", category: "approval", resourceType: "approval_request", resourceId: id, resourceName: ap.workflowName, metadata: { actionType: ap.actionType, runId: run.id } });
      return toApproval(row);
    }
    const { data: won } = await ctx.db.from("approval_requests").update({ status: "rejected", decided_by: ctx.user.id, decided_by_name: ctx.user.name, decided_at: now, decision_reason: reason.trim() }).eq("id", id).eq("workspace_id", ctx.workspace.id).eq("status", "pending").select("*");
    const row = won?.[0];
    if (!row) throw new ApiError("CONFLICT", "Someone else already decided this request. Refresh to see its status.");
    await ctx.db.from("workflow_runs").update({ status: run.status === "waiting_approval" ? "failed" : run.status, logs: [...run.logs, log("warn", `Approval rejected by ${ctx.user.name}: ${reason.trim()}. Run returned to failed.`)] }).eq("id", run.id).eq("workspace_id", ctx.workspace.id);
    await ctx.audit({ action: "approval.rejected", category: "approval", resourceType: "approval_request", resourceId: id, resourceName: ap.workflowName, metadata: { reason: reason.trim() } });
    return toApproval(row);
  });
}
