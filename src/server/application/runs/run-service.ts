import { ApiError, type Page, type SortDir } from "@/lib/api-error";
import { durationMs, retryBlockReason, runLog, stepsForCancel, stepsForResume } from "@/lib/domain/run-rules";
import { CANCELLABLE_RUN_STATUSES } from "@/lib/domain/status";
import type { AiAnalysis, ApprovalRequest, RunStatus, TriggerSource, WorkflowDefinition, WorkflowNode, WorkflowRun } from "@/lib/domain/types";
import type { ApprovalRepository, AnalysisRepository, RunRepository, VersionRepository, WorkflowRepository } from "../ports/repositories";
import type { EventBus } from "../ports/services";
import type { AuditLog } from "../shared/audit-log";
import type { RequestContext } from "../shared/context";
import { found } from "../shared/errors";
import { dayEnd, dayStart, offsetOf, pageOf } from "../shared/paging";
import type { RunLauncher } from "./run-launcher";

export interface RunListItem {
  id: string; workflowId: string; workflowName: string; version: number; status: RunStatus; trigger: TriggerSource; triggerDetail: string;
  startedAt: string; endedAt?: string; durationMs: number | null; stepCount: number; failedStep?: string; errorCode?: string; hasOpenException: boolean;
}
export type RunSortKey = "startedAt" | "duration" | "workflow" | "status";
export interface RunListParams { search?: string; status?: RunStatus | "all"; workflowId?: string | "all"; trigger?: TriggerSource | "all"; from?: string; to?: string; sort?: RunSortKey; dir?: SortDir; page?: number; pageSize?: number }
export interface RunDetail { run: WorkflowRun; nodes: WorkflowNode[]; edges: WorkflowDefinition["edges"]; approvals: ApprovalRequest[]; analyses: AiAnalysis[]; workflowStatus: string }

const UUID = /^[0-9a-f-]{36}$/;

/** Looks up a run inside the caller's workspace. */
export class RunFinder {
  constructor(private readonly runs: RunRepository) {}

  async find(ctx: RequestContext, id: string): Promise<WorkflowRun> {
    if (!UUID.test(id)) throw new ApiError("NOT_FOUND", "Run not found in this workspace.");
    return found(await this.runs.findInWorkspace(ctx.workspaceId, id), "Run not found in this workspace.");
  }
}

/** Resumes a failed run from its failed step: one more attempt, same idempotency key. */
export class RunResumer {
  constructor(
    private readonly runs: RunRepository,
    private readonly bus: EventBus,
  ) {}

  async resume(ctx: RequestContext, run: WorkflowRun, stepId: string, actorLabel: string): Promise<void> {
    const steps = stepsForResume(run.steps, stepId);
    const step = steps.find((s) => s.id === stepId)!;
    const row = await this.runs.passOf(run.id);
    const current = row?.pass ?? 0;
    const pass = current + 1;
    // Compare-and-set: only one concurrent retry/approval can move the run out of its current state and
    // claim the next pass; a second one finds no matching row and stops without dispatching.
    const claimed = await this.runs.claimPass(ctx.workspaceId, run.id, { pass: current, status: row?.status ?? run.status }, {
      status: "running", endedAt: null, pass, steps, logs: [...run.logs, runLog("info", `${actorLabel}: retrying “${step.nodeLabel}” once with the same idempotency key.`, stepId)],
    });
    if (!claimed) throw new ApiError("CONFLICT", "This run was just retried by someone else. Refresh to see its status.");
    // A deterministic event id makes a duplicate send for the same pass a no-op.
    await this.bus.requestRun({ runId: run.id, pass, resumeFromNodeId: step.nodeId }, `${run.id}:p${pass}`);
  }
}

export class RunService {
  constructor(
    private readonly runs: RunRepository,
    private readonly versions: VersionRepository,
    private readonly workflows: WorkflowRepository,
    private readonly approvals: ApprovalRepository,
    private readonly analyses: AnalysisRepository,
    private readonly finder: RunFinder,
    private readonly resumer: RunResumer,
    private readonly launcher: RunLauncher,
    private readonly bus: EventBus,
    private readonly audit: AuditLog,
  ) {}

  async list(ctx: RequestContext, params: RunListParams = {}): Promise<Page<RunListItem>> {
    const pageSize = params.pageSize ?? 15;
    const page = Math.max(1, params.page ?? 1);
    const s = params.search?.trim();
    const { rows, count } = await this.runs.search(ctx.workspaceId, {
      status: params.status && params.status !== "all" ? params.status : undefined,
      workflowId: params.workflowId && params.workflowId !== "all" ? params.workflowId : undefined,
      trigger: params.trigger && params.trigger !== "all" ? params.trigger : undefined,
      from: params.from ? dayStart(params.from) : undefined,
      to: params.to ? dayEnd(params.to) : undefined,
      runId: s && UUID.test(s) ? s : undefined,
      workflowNameLike: s && !UUID.test(s) ? s.replace(/[%_]/g, "") : undefined,
      sortColumn: params.sort === "workflow" ? "workflow_name" : params.sort === "status" ? "status" : "started_at",
      ascending: params.dir === "asc",
      offset: offsetOf(page, pageSize),
      limit: pageSize,
    });
    let items: RunListItem[] = rows.map((r) => {
      const failed = r.steps.find((x) => x.status === "failed");
      return {
        id: r.id, workflowId: r.workflowId, workflowName: r.workflowName, version: r.version, status: r.status, trigger: r.trigger.source, triggerDetail: r.trigger.detail,
        startedAt: r.startedAt, endedAt: r.endedAt, durationMs: durationMs(r.startedAt, r.endedAt),
        stepCount: r.steps.filter((x) => x.status !== "skipped").length, failedStep: failed?.nodeLabel, errorCode: failed?.errorCode, hasOpenException: r.exception?.status === "open",
      };
    });
    if (params.sort === "duration") items = items.sort((a, b) => (params.dir === "asc" ? 1 : -1) * ((a.durationMs ?? 1e15) - (b.durationMs ?? 1e15)));
    return pageOf(items, count, page, pageSize);
  }

  async get(ctx: RequestContext, id: string): Promise<RunDetail> {
    const run = await this.finder.find(ctx, id);
    const def = (await this.versions.definitionOf(run.workflowVersionId)) ?? { nodes: [], edges: [] };
    const [approvals, analyses, status] = [await this.approvals.listForRun(id), await this.analyses.listForRun(id), await this.workflows.statusOf(run.workflowId)];
    return { run, nodes: def.nodes, edges: def.edges, approvals, analyses, workflowStatus: status ?? "archived" };
  }

  async retryStep(ctx: RequestContext, runId: string, stepId: string) {
    const run = await this.finder.find(ctx, runId);
    if (run.status !== "failed") throw new ApiError("CONFLICT", run.status === "waiting_approval" ? "This run is waiting on an approval request. Decide it in Approvals." : "Only failed runs can be retried.");
    const step = run.steps.find((s) => s.id === stepId);
    if (!step || step.status !== "failed") throw new ApiError("CONFLICT", "Only the failed step can be retried.");
    const blocked = retryBlockReason(step);
    if (blocked) throw new ApiError("CONFLICT", blocked);
    await this.resumer.resume(ctx, run, stepId, `Manual retry by ${ctx.user.name}`);
    await this.audit.record(ctx, { action: "run.step_retried", category: "run", resourceType: "workflow_run", resourceId: runId, resourceName: run.workflowName, metadata: { step: step.nodeLabel } });
    return { ok: true };
  }

  async cancel(ctx: RequestContext, runId: string, reason: string) {
    const run = await this.finder.find(ctx, runId);
    if (!CANCELLABLE_RUN_STATUSES.includes(run.status)) throw new ApiError("CONFLICT", "This run has already finished.");
    const now = new Date().toISOString();
    await this.runs.update(runId, { status: "cancelled", endedAt: now, steps: stepsForCancel(run.steps, now), logs: [...run.logs, runLog("warn", `Cancelled by ${ctx.user.name}. In-flight activities stop at the next step boundary.`)] }, ctx.workspaceId);
    await this.approvals.expirePendingForRun(runId, "Run was cancelled.");
    await this.bus.cancelRun(runId).catch(() => undefined);
    await this.audit.record(ctx, { action: "run.cancelled", category: "run", resourceType: "workflow_run", resourceId: runId, resourceName: run.workflowName, metadata: { reason: reason || "No reason given" } });
    return { ok: true };
  }

  async rerun(ctx: RequestContext, runId: string): Promise<WorkflowRun> {
    const old = await this.finder.find(ctx, runId);
    const data = (await this.runs.contextOf(runId)) as { trigger?: Record<string, unknown> } | null;
    const wf = await this.workflows.runnable(old.workflowId);
    const run = await this.launcher.start({ workspaceId: ctx.workspaceId, workflow: wf!, input: data?.trigger ?? {}, trigger: { source: "manual", actorId: ctx.user.id, detail: `Re-run of ${old.id.slice(0, 8)} by ${ctx.user.name}` } });
    await this.audit.record(ctx, { action: "run.triggered", category: "run", resourceType: "workflow_run", resourceId: run.id, resourceName: old.workflowName, metadata: { rerunOf: old.id } });
    return run;
  }
}
