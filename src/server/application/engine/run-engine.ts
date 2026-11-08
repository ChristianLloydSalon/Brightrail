import { runLog, stepsForIteration, stepsForSuccess } from "@/lib/domain/run-rules";
import type { LogEntry, StepRun, WorkflowDefinition, WorkflowRun, WorkspaceSettings } from "@/lib/domain/types";
import { backoffSeconds, idempotencyKey } from "@/lib/engine/logic";
import { getPath } from "@/lib/utils";
import type { NotificationService } from "../notifications/notification-service";
import type { ApprovalRepository, RunRepository, VersionRepository, WorkspaceRepository } from "../ports/repositories";
import type { NodeExecutor } from "../ports/services";
import { type AuditLog, WORKER_ACTOR } from "../shared/audit-log";

/** A small, serializable result for the durable step history. */
export interface AttemptResult { ok: boolean; cancelled?: boolean; branch?: string; retryInSec?: number }

interface LoadedRun { run: WorkflowRun; def: WorkflowDefinition }

const LOOP_STATE = (loopId: string) => `__loop_${loopId}`;

/**
 * The worker's state machine for one run: each public method is one memoized durable step (an attempt,
 * a timer start, a failure, the finish, loop bookkeeping). The order of steps comes from lib/engine/walk.ts
 * and the durable orchestration lives in the Inngest adapter; this class only reads and writes run state.
 */
export class RunEngine {
  constructor(
    private readonly runs: RunRepository,
    private readonly versions: VersionRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly approvals: ApprovalRepository,
    private readonly executor: NodeExecutor,
    private readonly notifications: NotificationService,
    private readonly audit: AuditLog,
  ) {}

  async load(runId: string): Promise<LoadedRun> {
    const run = await this.runs.findById(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    const def = await this.versions.definitionOf(run.workflowVersionId);
    return { run, def: def! };
  }

  async definition(runId: string): Promise<WorkflowDefinition> {
    return (await this.load(runId)).def;
  }

  private async settings(workspaceId: string): Promise<Partial<WorkspaceSettings>> {
    return (await this.workspaces.findById(workspaceId))?.settings ?? {};
  }

  private async context(runId: string): Promise<Record<string, unknown>> {
    return (await this.runs.contextOf(runId)) ?? {};
  }

  /** One attempt of one node. */
  async attempt(runId: string, nodeId: string, maxAttempts: number): Promise<AttemptResult> {
    const { run, def } = await this.load(runId);
    if (run.status === "cancelled") return { ok: false, cancelled: true };
    const node = def.nodes.find((n) => n.id === nodeId)!;
    const steps = run.steps;
    const step = steps.find((s) => s.nodeId === nodeId)!;
    const logs = run.logs;
    const data = await this.context(runId);
    const attemptNo = step.attempts.length + 1;
    // Inside a loop each item gets its own key, so item 2 isn't mistaken for a retry of item 1.
    const scope = typeof data.__scope === "string" ? data.__scope : undefined;
    const key = idempotencyKey(runId, scope ? `${nodeId}@${scope}` : nodeId);
    const startedAt = new Date().toISOString();
    step.status = "running";
    step.attempt = attemptNo;
    step.startedAt ??= startedAt;
    step.attempts.push({ attempt: attemptNo, status: "running", startedAt, idempotencyKey: key });
    if (attemptNo > 1) logs.push(runLog("info", `Retrying “${step.nodeLabel}” (attempt ${attemptNo}) with the same idempotency key.`, step.id, { attempt: attemptNo, idempotencyKey: key }));
    await this.runs.update(runId, { status: "running", steps, logs });

    const res = await this.executor.execute(node, data, { id: runId, workspaceId: run.workspaceId, scope });
    const settings = await this.settings(run.workspaceId);
    const minimal = settings.payloadStorage === "minimal";
    const endedAt = new Date().toISOString();
    const current = step.attempts[step.attempts.length - 1]!;
    current.endedAt = endedAt;
    step.input = minimal ? undefined : res.input;
    if (res.ok) {
      current.status = "succeeded";
      Object.assign(step, { status: "succeeded", endedAt, output: minimal ? undefined : res.output, branch: res.branch, errorCode: undefined, errorMessage: undefined, errorClass: undefined });
      logs.push(runLog("info", `“${step.nodeLabel}” completed${res.branch ? ` — took the ${res.branch} branch` : ""}.`, step.id, { attempt: attemptNo }));
      await this.runs.saveContext(runId, res.data);
      await this.runs.update(runId, { status: "running", steps, logs });
      return { ok: true, branch: res.branch };
    }
    const f = res.failure;
    Object.assign(current, { status: "failed", errorCode: f.code, errorMessage: f.message });
    Object.assign(step, { errorCode: f.code, errorMessage: f.message, errorClass: f.errorClass });
    if (f.retryable && attemptNo < maxAttempts) {
      // Backoff follows the workspace's default retry policy (Settings → Workspace).
      const policy = settings.defaultRetry;
      const wait = policy ? backoffSeconds(attemptNo, policy.initialIntervalSec, policy.backoffCoefficient, policy.maxIntervalSec) : backoffSeconds(attemptNo);
      step.status = "retrying";
      logs.push(runLog("warn", `“${step.nodeLabel}” attempt ${attemptNo} failed (${f.code}). Retrying in ${wait}s.`, step.id, { errorCode: f.code, backoffSeconds: wait }));
      await this.runs.update(runId, { status: "retrying", steps, logs });
      return { ok: false, retryInSec: wait };
    }
    step.status = "failed";
    step.endedAt = endedAt;
    logs.push(runLog("error", `“${step.nodeLabel}” failed: ${f.message}`, step.id, { errorCode: f.code, attempt: attemptNo, idempotencyKey: key }));
    await this.runs.update(runId, { steps, logs });
    return { ok: false };
  }

  async markDelayStart(runId: string, nodeId: string): Promise<void> {
    const { run } = await this.load(runId);
    const steps = run.steps;
    const step = steps.find((s) => s.nodeId === nodeId)!;
    const now = new Date().toISOString();
    Object.assign(step, { status: "running", attempt: 1, startedAt: now });
    step.attempts = [{ attempt: 1, status: "running", startedAt: now, idempotencyKey: idempotencyKey(runId, nodeId) }];
    await this.runs.update(runId, { status: "running", steps, logs: [...run.logs, runLog("info", `Waiting on a durable timer for “${step.nodeLabel}”.`, step.id)] });
  }

  /** Terminal failure: apply the error handler (if routed) and open an exception for review. */
  async fail(runId: string, nodeId: string): Promise<{ continueFrom?: string }> {
    const { run, def } = await this.load(runId);
    const steps = run.steps;
    const logs = run.logs;
    const failed = steps.find((s) => s.nodeId === nodeId)!;
    const edge = def.edges.find((e) => e.source === nodeId && e.sourceHandle === "error");
    const handler = edge ? def.nodes.find((n) => n.id === edge.target && n.kind === "errorHandler") : undefined;
    const now = new Date().toISOString();
    if (handler && handler.kind === "errorHandler") {
      const hs = steps.find((s) => s.nodeId === handler.id)!;
      Object.assign(hs, { status: "succeeded", attempt: 1, startedAt: now, endedAt: now, input: { failedStep: failed.nodeLabel, errorCode: failed.errorCode ?? null }, output: { strategy: handler.config.strategy } });
      hs.attempts = [{ attempt: 1, status: "succeeded", startedAt: now, endedAt: now, idempotencyKey: idempotencyKey(runId, handler.id) }];
      logs.push(runLog("warn", `Error handler “${handler.label}” applied: ${handler.config.strategy.replace(/_/g, " ")}.`, hs.id));
      if (handler.config.strategy === "fallback_path") {
        await this.runs.update(runId, { steps, logs });
        return { continueFrom: handler.id };
      }
      if (handler.config.strategy === "notify")
        await this.notifyFailure(run, `${run.workflowName}: ${failed.nodeLabel} failed`, `Routed to ${handler.config.notifyChannel ?? "the team"} by “${handler.label}”.`);
    }
    const openException = !handler || handler.kind !== "errorHandler" || handler.config.strategy !== "fail_run";
    logs.push(runLog("error", openException ? "Run failed. An exception was opened for operator review." : "Run failed.", undefined, { errorCode: failed.errorCode ?? "UNKNOWN" }));
    await this.runs.update(runId, { status: "failed", endedAt: now, steps, logs, exception: openException ? { status: "open", openedAt: now } : null });
    await this.notifyFailure(run, `${run.workflowName} failed`, `${failed.nodeLabel} failed with ${failed.errorCode}.${openException ? " An exception is open." : ""}`);
    await this.audit.recordFor(run.workspaceId, WORKER_ACTOR, { action: "run.failed", category: "run", resourceType: "workflow_run", resourceId: runId, resourceName: run.workflowName, metadata: { errorCode: failed.errorCode ?? "UNKNOWN" } });
    await this.approvals.settleOutcome(runId, "still_failing");
    return {};
  }

  private notifyFailure(run: WorkflowRun, title: string, body: string) {
    return this.notifications.create({ workspaceId: run.workspaceId, kind: "run_failed", title, body, href: `/executions/${run.id}` });
  }

  async finish(runId: string): Promise<void> {
    const { run } = await this.load(runId);
    if (run.status === "cancelled") return;
    const now = new Date().toISOString();
    const exception = run.exception?.status === "open" ? { ...run.exception, status: "resolved" as const, resolvedAt: now } : run.exception;
    await this.runs.update(runId, { status: "succeeded", endedAt: now, steps: stepsForSuccess(run.steps), exception, logs: [...run.logs, runLog("info", "Run succeeded. All required steps completed.")] });
    await this.approvals.settleOutcome(runId, "resolved");
  }

  /* ---------------- loops ---------------- */

  /** Snapshot the list (so the body can't change what it iterates over) and save the outer item, for nesting. */
  async beginLoop(runId: string, loopId: string): Promise<{ count: number }> {
    const { def } = await this.load(runId);
    const node = def.nodes.find((n) => n.id === loopId);
    if (node?.kind !== "loop") return { count: 0 };
    const data = await this.context(runId);
    const list = getPath(data, node.config.field);
    const items = Array.isArray(list) ? list.slice(0, node.config.maxItems) : [];
    data[LOOP_STATE(loopId)] = { items, saved: { item: data.item ?? null, index: data.index ?? null, loop: data.loop ?? null, scope: data.__scope ?? null } };
    await this.runs.saveContext(runId, data);
    return { count: items.length };
  }

  /** Sets item/index for one iteration and resets the body's step records so retries count per item. */
  async beginIteration(runId: string, loopId: string, i: number, bodyIds: string[]): Promise<void> {
    const { run } = await this.load(runId);
    const data = await this.context(runId);
    const st = data[LOOP_STATE(loopId)] as { items: unknown[]; saved: { scope: string | null } };
    const count = st.items.length;
    data.item = st.items[i] ?? null;
    data.index = i;
    data.loop = { index: i, number: i + 1, count, first: i === 0, last: i === count - 1 };
    data.__scope = `${st.saved.scope ? `${st.saved.scope}/` : ""}${loopId}:${i}`;
    await this.runs.saveContext(runId, data);
    const steps: StepRun[] = stepsForIteration(run.steps, bodyIds);
    const loopStep = steps.find((s) => s.nodeId === loopId);
    const logs: LogEntry[] = [...run.logs, runLog("info", `“${loopStep?.nodeLabel ?? "For each"}”: item ${i + 1} of ${count}.`, loopStep?.id, { index: i })];
    await this.runs.update(runId, { steps, logs });
  }

  /** Restores the outer item/index (for nested loops) and drops the snapshot. */
  async endLoop(runId: string, loopId: string): Promise<void> {
    const data = await this.context(runId);
    const st = data[LOOP_STATE(loopId)] as { items: unknown[]; saved: Record<string, unknown> } | undefined;
    if (!st) return;
    for (const k of ["item", "index", "loop"]) data[k] = st.saved[k] ?? null;
    if (st.saved.scope) data.__scope = st.saved.scope;
    else delete data.__scope;
    delete data[LOOP_STATE(loopId)];
    await this.runs.saveContext(runId, data);
  }
}
