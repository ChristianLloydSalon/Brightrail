import { ApiError } from "@/lib/api-error";
import { checkPolicy } from "@/lib/ai/advisor";
import { retryBlockReason, runLog } from "@/lib/domain/run-rules";
import type { AiAnalysis, ApprovalRequest, ApprovalStatus } from "@/lib/domain/types";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import type { NotificationService } from "../notifications/notification-service";
import type { AnalysisRepository, ApprovalRepository, ConnectionRepository, RunRepository, VersionRepository, WorkflowRepository } from "../ports/repositories";
import type { AppConfig, FailureAdvisor, RateLimiter } from "../ports/services";
import type { AuditLog } from "../shared/audit-log";
import type { RequestContext } from "../shared/context";
import { found, onDuplicate } from "../shared/errors";
import type { ApprovalExpiryService } from "./approval-expiry-service";
import type { RunFinder, RunResumer } from "./run-service";

/** Each analysis calls the operator-paid model, so it's capped per workspace per hour. */
const AI_ANALYSES_PER_HOUR = 60;

/**
 * The AI exception assistant (advisory only) and the human approval gate in front of any recovery it
 * recommends. Permissions and resource state are re-checked at decision time, not just at request time.
 */
export class ApprovalService {
  constructor(
    private readonly approvals: ApprovalRepository,
    private readonly analyses: AnalysisRepository,
    private readonly runs: RunRepository,
    private readonly versions: VersionRepository,
    private readonly workflows: WorkflowRepository,
    private readonly connections: ConnectionRepository,
    private readonly finder: RunFinder,
    private readonly resumer: RunResumer,
    private readonly expiry: ApprovalExpiryService,
    private readonly advisor: FailureAdvisor,
    private readonly limiter: RateLimiter,
    private readonly notifications: NotificationService,
    private readonly audit: AuditLog,
    private readonly config: AppConfig,
  ) {}

  async analyze(ctx: RequestContext, runId: string): Promise<AiAnalysis> {
    if (!ctx.workspace.settings.aiAssistantEnabled) throw new ApiError("FORBIDDEN", "The AI assistant is turned off in workspace settings.");
    const budget = await this.limiter.hit(`ai-analyze:${ctx.workspaceId}`, 3600);
    if (budget.error !== undefined) {
      console.error("[brightrail] AI analysis budget counter unavailable — run 0008_security_fixes.sql", budget.error);
      if (this.config.production) throw new ApiError("NOT_CONFIGURED", "The AI assistant is temporarily unavailable.");
    } else if (typeof budget.count === "number" && budget.count > AI_ANALYSES_PER_HOUR) throw new ApiError("RATE_LIMITED", `This workspace can run ${AI_ANALYSES_PER_HOUR} AI analyses per hour. Try again later.`);
    const run = await this.finder.find(ctx, runId);
    const step = run.steps.find((s) => s.status === "failed");
    if (!step) throw new ApiError("CONFLICT", "There's no failed step to analyze in this run.");
    const node = (await this.versions.definitionOf(run.workflowVersionId))?.nodes.find((n) => n.id === step.nodeId);
    const connections = await this.connections.listByWorkspace(ctx.workspaceId);
    const out = await this.advisor.analyze({ run, step, node, integrations: INTEGRATIONS, connections, actor: { id: ctx.user.id, role: ctx.member.role }, grants: ctx.workspace.grants, aiEnabled: true });
    const saved = await this.analyses.insert({ workspaceId: ctx.workspaceId, runId, stepId: step.id, createdBy: ctx.user.id, data: out });
    await this.audit.record(ctx, { action: "ai.analysis_requested", category: "approval", resourceType: "workflow_run", resourceId: runId, resourceName: run.workflowName, metadata: { model: out.model, promptVersion: out.promptVersion, classification: out.classification } });
    return saved;
  }

  async request(ctx: RequestContext, analysisId: string): Promise<ApprovalRequest> {
    const a = found(await this.analyses.findInWorkspace(ctx.workspaceId, analysisId), "Analysis not found.");
    const run = await this.finder.find(ctx, a.runId);
    const step = found(run.steps.find((s) => s.id === a.stepId), "Step not found.");
    if (a.approvalRequestId) throw new ApiError("CONFLICT", "This recommendation was already sent for approval. Ask the assistant for a new one.");
    if (step.endedAt && a.createdAt < step.endedAt) throw new ApiError("CONFLICT", "This analysis is from an earlier failure of the step. Ask the assistant again.");
    // Same rule as a manual retry: retrying a permission or validation failure can't succeed.
    const blocked = retryBlockReason(step);
    if (blocked) throw new ApiError("CONFLICT", blocked);
    if (await this.approvals.hasPending(run.id)) throw new ApiError("CONFLICT", "This run already has a pending approval request.");
    const policy = checkPolicy({ actionType: a.recommendation.actionType, actor: { role: ctx.member.role }, grants: ctx.workspace.grants, aiEnabled: ctx.workspace.settings.aiAssistantEnabled, run, step });
    if (!policy.allowed || !policy.requiresApproval) throw new ApiError("FORBIDDEN", policy.reasons[0] ?? "This recommendation can't be dispatched.");
    // The unique pending-approval index (0008) turns a concurrent duplicate into a clean conflict.
    const approval = await onDuplicate(
      () => this.approvals.insert({
        workspaceId: ctx.workspaceId, runId: run.id, stepId: step.id, workflowName: run.workflowName, analysisId: a.id, actionType: a.recommendation.actionType,
        toolCall: a.recommendation.toolCall, rationale: a.summary, requestedBy: { type: "ai", id: "ai-assistant", name: `AI exception assistant (requested by ${ctx.user.name})` },
        expiresAt: new Date(Date.now() + ctx.workspace.settings.approvalExpiryHours * 3600_000).toISOString(),
      }),
      () => new ApiError("CONFLICT", "This run already has a pending approval request."),
    );
    await this.analyses.linkApproval(ctx.workspaceId, a, approval.id);
    await this.runs.update(run.id, { status: "waiting_approval", logs: [...run.logs, runLog("info", `Approval request created for ${a.recommendation.toolCall.name}. Waiting for an authorized decision.`)] }, ctx.workspaceId);
    await this.expiry.schedule(approval.id, approval.expiresAt);
    await this.notifications.create({ workspaceId: ctx.workspaceId, kind: "approval_requested", title: `Approval needed: retry “${step.nodeLabel}”`, body: run.workflowName, href: "/approvals" });
    await this.audit.record(ctx, { action: "approval.requested", category: "approval", resourceType: "approval_request", resourceId: approval.id, resourceName: run.workflowName, actor: { type: "ai", id: "ai-assistant", name: "AI exception assistant" }, metadata: { actionType: a.recommendation.actionType, requestedFor: ctx.user.name } });
    return approval;
  }

  async list(ctx: RequestContext, status: ApprovalStatus | "all" = "all"): Promise<ApprovalRequest[]> {
    // Background jobs expire requests on time; this catches any the worker hasn't reached yet.
    await this.expiry.sweep(ctx.workspaceId);
    return this.approvals.list(ctx.workspaceId, status, 200);
  }

  async decide(ctx: RequestContext, id: string, decision: "approve" | "reject", reason: string): Promise<ApprovalRequest> {
    const ap = found(await this.approvals.findInWorkspace(ctx.workspaceId, id), "Approval request not found.");
    if (ap.status !== "pending") throw new ApiError("CONFLICT", `This request was already ${ap.status}.`);
    if (new Date(ap.expiresAt).getTime() < Date.now()) throw new ApiError("CONFLICT", "This request expired. Ask the assistant for a new recommendation.");
    if (decision === "reject" && reason.trim().length < 3) throw new ApiError("VALIDATION", "Add a reason.", { reason: "Add a short reason so the requester knows what to do next." });
    const run = await this.finder.find(ctx, ap.runId);
    const now = new Date().toISOString();
    const decidedBy = { decidedBy: ctx.user.id, decidedByName: ctx.user.name, decidedAt: now };

    if (decision === "approve") {
      const step = run.steps.find((s) => s.id === ap.stepId);
      if (!step || step.status !== "failed") throw new ApiError("CONFLICT", "The target step is no longer in a failed state.");
      // Re-check policy and resource state at decision time, not just when the request was made.
      const policy = checkPolicy({ actionType: ap.actionType, actor: { role: ctx.member.role }, grants: ctx.workspace.grants, aiEnabled: ctx.workspace.settings.aiAssistantEnabled, run, step });
      if (!policy.allowed) throw new ApiError("CONFLICT", policy.reasons.find((r) => !r.startsWith("Retries are consequential")) ?? "This action can no longer be dispatched.");
      if ((await this.workflows.statusOf(run.workflowId, ctx.workspaceId)) !== "active") throw new ApiError("CONFLICT", "The workflow is paused or archived. Resume it before approving a retry.");
      // Conditional update: wins only if nobody else decided and it hasn't expired in the meantime.
      const won = await this.approvals.decideIfPending(ctx.workspaceId, id, { status: "approved", ...decidedBy, decisionReason: reason.trim() || null, outcome: "pending" }, now);
      if (!won) throw new ApiError("CONFLICT", "Someone else decided this request, or it just expired. Refresh to see its status.");
      await this.resumer.resume(ctx, run, ap.stepId, `Approved recovery by ${ctx.user.name}`);
      await this.audit.record(ctx, { action: "approval.approved", category: "approval", resourceType: "approval_request", resourceId: id, resourceName: ap.workflowName, metadata: { actionType: ap.actionType, runId: run.id } });
      return won;
    }

    const won = await this.approvals.decideIfPending(ctx.workspaceId, id, { status: "rejected", ...decidedBy, decisionReason: reason.trim() });
    if (!won) throw new ApiError("CONFLICT", "Someone else already decided this request. Refresh to see its status.");
    await this.runs.update(run.id, { status: run.status === "waiting_approval" ? "failed" : run.status, logs: [...run.logs, runLog("warn", `Approval rejected by ${ctx.user.name}: ${reason.trim()}. Run returned to failed.`)] }, ctx.workspaceId);
    await this.audit.record(ctx, { action: "approval.rejected", category: "approval", resourceType: "approval_request", resourceId: id, resourceName: ap.workflowName, metadata: { reason: reason.trim() } });
    return won;
  }
}
