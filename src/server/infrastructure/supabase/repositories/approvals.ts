import "server-only";
import type { AiAnalysis, ApprovalRequest, ApprovalStatus } from "@/lib/domain/types";
import type { AnalysisRepository, ApprovalRepository, StoredAnalysis } from "@/server/application/ports/repositories";
import { must, mustUnique } from "../errors";
import { toAnalysis, toApproval } from "../mappers";
import { SupabaseRepository } from "./base";

export class SupabaseApprovalRepository extends SupabaseRepository implements ApprovalRepository {
  async listForRun(runId: string): Promise<ApprovalRequest[]> {
    const { data } = await this.db.from("approval_requests").select("*").eq("run_id", runId).order("requested_at", { ascending: false });
    return (data ?? []).map(toApproval);
  }

  async hasPending(runId: string): Promise<boolean> {
    const { data } = await this.db.from("approval_requests").select("id").eq("run_id", runId).eq("status", "pending");
    return !!data?.length;
  }

  async countPending(workspaceId: string): Promise<number> {
    const { count } = await this.db.from("approval_requests").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "pending");
    return count ?? 0;
  }

  async pendingRunIds(workspaceId: string): Promise<string[]> {
    const { data } = await this.db.from("approval_requests").select("run_id").eq("workspace_id", workspaceId).eq("status", "pending");
    return (data ?? []).map((a) => a.run_id as string);
  }

  async overdueIds(now: string, workspaceId?: string, limit?: number): Promise<string[]> {
    let q = this.db.from("approval_requests").select("id").eq("status", "pending").lte("expires_at", now);
    if (workspaceId) q = q.eq("workspace_id", workspaceId);
    if (limit) q = q.limit(limit);
    const { data } = await q;
    return (data ?? []).map((r) => r.id as string);
  }

  async list(workspaceId: string, status: ApprovalStatus | "all", limit: number): Promise<ApprovalRequest[]> {
    let q = this.db.from("approval_requests").select("*").eq("workspace_id", workspaceId).order("requested_at", { ascending: false }).limit(limit);
    if (status !== "all") q = q.eq("status", status);
    const { data } = await q;
    return (data ?? []).map(toApproval);
  }

  async findInWorkspace(workspaceId: string, id: string): Promise<ApprovalRequest | null> {
    const { data } = await this.db.from("approval_requests").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    return data ? toApproval(data) : null;
  }

  async insert(row: Parameters<ApprovalRepository["insert"]>[0]): Promise<ApprovalRequest> {
    return toApproval(mustUnique(await this.db.from("approval_requests").insert({
      workspace_id: row.workspaceId, run_id: row.runId, step_id: row.stepId, workflow_name: row.workflowName, analysis_id: row.analysisId, action_type: row.actionType,
      tool_call: row.toolCall, rationale: row.rationale, requested_by: row.requestedBy, expires_at: row.expiresAt,
    }).select("*").single()));
  }

  async decideIfPending(workspaceId: string, id: string, patch: Parameters<ApprovalRepository["decideIfPending"]>[2], unexpiredAt?: string): Promise<ApprovalRequest | null> {
    let q = this.db.from("approval_requests").update({
      status: patch.status, decided_by: patch.decidedBy, decided_by_name: patch.decidedByName, decided_at: patch.decidedAt, decision_reason: patch.decisionReason,
      ...(patch.outcome ? { outcome: patch.outcome } : {}),
    }).eq("id", id).eq("workspace_id", workspaceId).eq("status", "pending");
    if (unexpiredAt) q = q.gt("expires_at", unexpiredAt);
    const { data } = await q.select("*");
    return data?.[0] ? toApproval(data[0]) : null;
  }

  async expirePendingForRun(runId: string, reason: string): Promise<void> {
    await this.db.from("approval_requests").update({ status: "expired", decision_reason: reason }).eq("run_id", runId).eq("status", "pending");
  }

  async settleOutcome(runId: string, outcome: "resolved" | "still_failing"): Promise<void> {
    await this.db.from("approval_requests").update({ outcome }).eq("run_id", runId).eq("status", "approved").eq("outcome", "pending");
  }

  async expireIfDue(id: string, now: string) {
    const { data } = await this.db.from("approval_requests").update({ status: "expired", decided_at: now }).eq("id", id).eq("status", "pending").lte("expires_at", now).select("id, workspace_id, run_id, workflow_name, step_id");
    const r = data?.[0];
    return r ? { id: r.id as string, workspaceId: r.workspace_id as string, runId: r.run_id as string, workflowName: r.workflow_name as string, stepId: r.step_id as string } : null;
  }
}

export class SupabaseAnalysisRepository extends SupabaseRepository implements AnalysisRepository {
  async listForRun(runId: string): Promise<AiAnalysis[]> {
    const { data } = await this.db.from("ai_analyses").select("*").eq("run_id", runId).order("created_at", { ascending: false });
    return (data ?? []).map(toAnalysis);
  }

  async findInWorkspace(workspaceId: string, id: string): Promise<StoredAnalysis | null> {
    const { data } = await this.db.from("ai_analyses").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    return data ? toAnalysis(data) : null;
  }

  async insert(row: { workspaceId: string; runId: string; stepId: string; createdBy: string; data: unknown }): Promise<AiAnalysis> {
    return toAnalysis(must(await this.db.from("ai_analyses").insert({ workspace_id: row.workspaceId, run_id: row.runId, step_id: row.stepId, created_by: row.createdBy, data: row.data }).select("*").single()));
  }

  async linkApproval(workspaceId: string, analysis: StoredAnalysis, approvalId: string): Promise<void> {
    await this.db.from("ai_analyses").update({ data: { ...analysis, approvalRequestId: approvalId } }).eq("id", analysis.id).eq("workspace_id", workspaceId);
  }
}
