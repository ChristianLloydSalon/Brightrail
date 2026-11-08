import "server-only";
import { ApiError } from "@/lib/api-error";
import { NODE_META, UNIT_SECONDS } from "@/lib/domain/nodes";
import { redact } from "@/lib/domain/redaction";
import type { JsonValue, LogEntry, StepRun, TriggerSource, WorkflowDefinition, WorkflowNode, WorkspaceSettings } from "@/lib/domain/types";
import { backoffSeconds, idempotencyKey, runContextFrom } from "@/lib/engine/logic";
import { uid } from "@/lib/utils";
import { adminClient } from "../supabase";
import { executeNode } from "./executors";
import { createWalker } from "@/lib/engine/walk";
import { getPath } from "@/lib/utils";

import { inngest } from "./client";
import { createNotification } from "../notifications";

export { inngest };

export const RUN_REQUESTED = "workflow/run.requested";
export const RUN_CANCELLED = "workflow/run.cancelled";

 
type RunRow = Record<string, any>;

export function orderNodes(def: WorkflowDefinition): WorkflowNode[] {
  const out: WorkflowNode[] = [];
  const seen = new Set<string>();
  const trigger = def.nodes.find((n) => n.kind === "trigger");
  const queue = trigger ? [trigger.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = def.nodes.find((x) => x.id === id);
    if (n) out.push(n);
    for (const e of def.edges) if (e.source === id) queue.push(e.target);
  }
  return [...out, ...def.nodes.filter((n) => !seen.has(n.id))];
}

function log(level: LogEntry["level"], message: string, stepId?: string, fields?: LogEntry["fields"]): LogEntry {
  return { id: uid("log", 8), ts: new Date().toISOString(), level, message, stepId, fields };
}

/** Creates the run record and its private context, then hands the run to the durable worker. */
/** Monthly execution quota (workspaces.quotas.executionsPerMonth), counted per calendar month in UTC. */
export async function assertRunQuota(workspaceId: string) {
  const db = adminClient();
  const { data: ws } = await db.from("workspaces").select("quotas").eq("id", workspaceId).single();
  const limit = Number((ws?.quotas as { executionsPerMonth?: number } | null)?.executionsPerMonth ?? 1000);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const { count } = await db.from("workflow_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("started_at", monthStart);
  if ((count ?? 0) >= limit) throw new ApiError("RATE_LIMITED", `This workspace has used all ${limit} runs for this month. The limit resets on the 1st of the month (UTC).`);
}

export async function startRun(p: {
  workspaceId: string;
  workflow: { id: string; name: string; status: string; current_version_id: string | null };
  input: Record<string, unknown>;
  trigger: { source: TriggerSource; actorId?: string; detail: string };
}) {
  const db = adminClient();
  if (p.workflow.status !== "active") throw new ApiError("CONFLICT", p.workflow.status === "paused" ? "This workflow is paused. Resume it to accept runs." : "Only active (published) workflows can run.");
  if (!p.workflow.current_version_id) throw new ApiError("CONFLICT", "Publish a version before running this workflow.");
  await assertRunQuota(p.workspaceId);
  const { data: ver } = await db.from("workflow_versions").select("*").eq("id", p.workflow.current_version_id).single();
  if (!ver) throw new ApiError("CONFLICT", "The published version couldn't be found.");
  const def = ver.definition as WorkflowDefinition;
  const minimal = await storesMinimalPayloads(p.workspaceId);
  const steps: StepRun[] = orderNodes(def).map((n) => ({ id: uid("step", 10), runId: "", nodeId: n.id, nodeLabel: n.label, nodeKind: n.kind, status: "pending", attempt: 0, attempts: [] }));
  const correlationId = uid("corr", 10);
  const { data: run, error } = await db
    .from("workflow_runs")
    .insert({
      workspace_id: p.workspaceId, workflow_id: p.workflow.id, workflow_name: p.workflow.name, workflow_version_id: ver.id, version: ver.version,
      status: "queued", trigger: p.trigger, input: minimal ? {} : redact(p.input as JsonValue), correlation_id: correlationId, steps,
      logs: [log("info", `Run accepted from ${p.trigger.source} trigger; pinned to version ${ver.version}.`, undefined, { correlationId })],
    })
    .select("*")
    .single();
  if (error || !run) throw new ApiError("INTERNAL", "Couldn't create the run.");
  await db.from("workflow_runs").update({ steps: steps.map((s) => ({ ...s, runId: run.id })) }).eq("id", run.id);
  await db.from("run_contexts").insert({ run_id: run.id, data: runContextFrom(p.input) });
  try {
    await inngest.send({ name: RUN_REQUESTED, data: { runId: run.id, pass: 0 } });
  } catch (e) {
    await db.from("workflow_runs").update({ status: "failed", ended_at: new Date().toISOString(), logs: [...run.logs, log("error", "The workflow worker couldn't be reached. Check the Inngest configuration (see SETUP.md).")] }).eq("id", run.id);
    console.error("[brightrail] inngest.send failed", e);
    throw new ApiError("NOT_CONFIGURED", "The run was created but the workflow worker couldn't be reached. Check INNGEST settings in .env.");
  }
  return run as RunRow;
}

/** Workspace setting "Store minimal metadata only": no input/output bodies in run history. */
async function workspaceSettings(workspaceId: string): Promise<Partial<WorkspaceSettings>> {
  const { data } = await adminClient().from("workspaces").select("settings").eq("id", workspaceId).maybeSingle();
  return (data?.settings as Partial<WorkspaceSettings> | null) ?? {};
}
async function storesMinimalPayloads(workspaceId: string): Promise<boolean> {
  return (await workspaceSettings(workspaceId)).payloadStorage === "minimal";
}

async function loadRun(runId: string) {
  const db = adminClient();
  const { data: run } = await db.from("workflow_runs").select("*").eq("id", runId).single();
  if (!run) throw new Error(`Run ${runId} not found`);
  const { data: ver } = await db.from("workflow_versions").select("definition").eq("id", run.workflow_version_id).single();
  return { db, run: run as RunRow, def: ver!.definition as WorkflowDefinition };
}

async function saveRun(runId: string, patch: Record<string, unknown>) {
  await adminClient().from("workflow_runs").update(patch).eq("id", runId);
}

function notify(workspaceId: string, kind: "run_failed", title: string, body: string, href: string) {
  return createNotification({ workspaceId, kind, title, body, href });
}

/** One attempt of one node. Returns a small, serializable result for Inngest's step history. */
export async function runAttempt(runId: string, nodeId: string, maxAttempts: number): Promise<{ ok: boolean; cancelled?: boolean; branch?: string; retryInSec?: number }> {
  const { db, run, def } = await loadRun(runId);
  if (run.status === "cancelled") return { ok: false, cancelled: true };
  const node = def.nodes.find((n) => n.id === nodeId)!;
  const steps = run.steps as StepRun[];
  const step = steps.find((s) => s.nodeId === nodeId)!;
  const logs = run.logs as LogEntry[];
  const { data: ctxRow } = await db.from("run_contexts").select("data").eq("run_id", runId).single();
  const data = (ctxRow?.data ?? {}) as Record<string, unknown>;
  const attemptNo = step.attempts.length + 1;
  // Inside a loop each item gets its own key, so item 2 isn't mistaken for a retry of item 1.
  const scope = typeof data.__scope === "string" ? data.__scope : undefined;
  const key = idempotencyKey(runId, scope ? `${nodeId}@${scope}` : nodeId);
  const startedAt = new Date().toISOString();
  step.status = "running";
  step.attempt = attemptNo;
  step.startedAt ??= startedAt;
  step.attempts.push({ attempt: attemptNo, status: "running", startedAt, idempotencyKey: key });
  if (attemptNo > 1) logs.push(log("info", `Retrying “${step.nodeLabel}” (attempt ${attemptNo}) with the same idempotency key.`, step.id, { attempt: attemptNo, idempotencyKey: key }));
  await saveRun(runId, { status: "running", steps, logs });

  const res = await executeNode(node, data, { id: runId, workspaceId: run.workspace_id, scope });
  const settings = await workspaceSettings(run.workspace_id);
  const minimal = settings.payloadStorage === "minimal";
  const endedAt = new Date().toISOString();
  const current = step.attempts[step.attempts.length - 1]!;
  current.endedAt = endedAt;
  step.input = minimal ? undefined : res.input;
  if (res.ok) {
    current.status = "succeeded";
    Object.assign(step, { status: "succeeded", endedAt, output: minimal ? undefined : res.output, branch: res.branch, errorCode: undefined, errorMessage: undefined, errorClass: undefined });
    logs.push(log("info", `“${step.nodeLabel}” completed${res.branch ? ` — took the ${res.branch} branch` : ""}.`, step.id, { attempt: attemptNo }));
    await db.from("run_contexts").update({ data: res.data }).eq("run_id", runId);
    await saveRun(runId, { status: "running", steps, logs });
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
    logs.push(log("warn", `“${step.nodeLabel}” attempt ${attemptNo} failed (${f.code}). Retrying in ${wait}s.`, step.id, { errorCode: f.code, backoffSeconds: wait }));
    await saveRun(runId, { status: "retrying", steps, logs });
    return { ok: false, retryInSec: wait };
  }
  step.status = "failed";
  step.endedAt = endedAt;
  logs.push(log("error", `“${step.nodeLabel}” failed: ${f.message}`, step.id, { errorCode: f.code, attempt: attemptNo, idempotencyKey: key }));
  await saveRun(runId, { steps, logs });
  return { ok: false };
}

export async function markDelayStart(runId: string, nodeId: string) {
  const { run } = await loadRun(runId);
  const steps = run.steps as StepRun[];
  const step = steps.find((s) => s.nodeId === nodeId)!;
  const now = new Date().toISOString();
  Object.assign(step, { status: "running", attempt: 1, startedAt: now });
  step.attempts = [{ attempt: 1, status: "running", startedAt: now, idempotencyKey: idempotencyKey(runId, nodeId) }];
  await saveRun(runId, { status: "running", steps, logs: [...run.logs, log("info", `Waiting on a durable timer for “${step.nodeLabel}”.`, step.id)] });
}

/** Terminal failure: apply the error handler (if routed) and open an exception for review. */
export async function failRun(runId: string, nodeId: string): Promise<{ continueFrom?: string }> {
  const { run, def } = await loadRun(runId);
  const steps = run.steps as StepRun[];
  const logs = run.logs as LogEntry[];
  const failed = steps.find((s) => s.nodeId === nodeId)!;
  const edge = def.edges.find((e) => e.source === nodeId && e.sourceHandle === "error");
  const handler = edge ? def.nodes.find((n) => n.id === edge.target && n.kind === "errorHandler") : undefined;
  const now = new Date().toISOString();
  if (handler && handler.kind === "errorHandler") {
    const hs = steps.find((s) => s.nodeId === handler.id)!;
    Object.assign(hs, { status: "succeeded", attempt: 1, startedAt: now, endedAt: now, input: { failedStep: failed.nodeLabel, errorCode: failed.errorCode ?? null }, output: { strategy: handler.config.strategy } });
    hs.attempts = [{ attempt: 1, status: "succeeded", startedAt: now, endedAt: now, idempotencyKey: idempotencyKey(runId, handler.id) }];
    logs.push(log("warn", `Error handler “${handler.label}” applied: ${handler.config.strategy.replace(/_/g, " ")}.`, hs.id));
    if (handler.config.strategy === "fallback_path") {
      await saveRun(runId, { steps, logs });
      return { continueFrom: handler.id };
    }
    if (handler.config.strategy === "notify")
      await notify(run.workspace_id, "run_failed", `${run.workflow_name}: ${failed.nodeLabel} failed`, `Routed to ${handler.config.notifyChannel ?? "the team"} by “${handler.label}”.`, `/executions/${runId}`);
  }
  const openException = !handler || handler.kind !== "errorHandler" || handler.config.strategy !== "fail_run";
  logs.push(log("error", openException ? "Run failed. An exception was opened for operator review." : "Run failed.", undefined, { errorCode: failed.errorCode ?? "UNKNOWN" }));
  await saveRun(runId, { status: "failed", ended_at: now, steps, logs, exception: openException ? { status: "open", openedAt: now } : null });
  await notify(run.workspace_id, "run_failed", `${run.workflow_name} failed`, `${failed.nodeLabel} failed with ${failed.errorCode}.${openException ? " An exception is open." : ""}`, `/executions/${runId}`);
  await adminClient().from("audit_events").insert({ workspace_id: run.workspace_id, actor: { type: "service", id: "svc_worker", name: "Workflow worker" }, action: "run.failed", category: "run", resource_type: "workflow_run", resource_id: runId, resource_name: run.workflow_name, metadata: { errorCode: failed.errorCode ?? "UNKNOWN" } });
  await adminClient().from("approval_requests").update({ outcome: "still_failing" }).eq("run_id", runId).eq("status", "approved").eq("outcome", "pending");
  return {};
}

export async function finishRun(runId: string) {
  const { run } = await loadRun(runId);
  if (run.status === "cancelled") return;
  const steps = (run.steps as StepRun[]).map((s) => (s.status === "pending" ? { ...s, status: "skipped" as const } : s));
  const now = new Date().toISOString();
  const exception = run.exception?.status === "open" ? { ...run.exception, status: "resolved", resolvedAt: now } : run.exception;
  await saveRun(runId, { status: "succeeded", ended_at: now, steps, exception, logs: [...run.logs, log("info", "Run succeeded. All required steps completed.")] });
  await adminClient().from("approval_requests").update({ outcome: "resolved" }).eq("run_id", runId).eq("status", "approved").eq("outcome", "pending");
}

/* ---------------- loops ---------------- */

const LOOP_STATE = (loopId: string) => `__loop_${loopId}`;

/** Snapshot the list (so the body can't change what it iterates over) and save the outer item, for nesting. */
export async function beginLoop(runId: string, loopId: string): Promise<{ count: number }> {
  const { db, def } = await loadRun(runId);
  const node = def.nodes.find((n) => n.id === loopId);
  if (node?.kind !== "loop") return { count: 0 };
  const { data: ctxRow } = await db.from("run_contexts").select("data").eq("run_id", runId).single();
  const data = (ctxRow?.data ?? {}) as Record<string, unknown>;
  const list = getPath(data, node.config.field);
  const items = Array.isArray(list) ? list.slice(0, node.config.maxItems) : [];
  data[LOOP_STATE(loopId)] = { items, saved: { item: data.item ?? null, index: data.index ?? null, loop: data.loop ?? null, scope: data.__scope ?? null } };
  await db.from("run_contexts").update({ data }).eq("run_id", runId);
  return { count: items.length };
}

/** Sets item/index for one iteration and resets the body's step records so retries count per item. */
export async function beginIteration(runId: string, loopId: string, i: number, bodyIds: string[]) {
  const { db, run } = await loadRun(runId);
  const { data: ctxRow } = await db.from("run_contexts").select("data").eq("run_id", runId).single();
  const data = (ctxRow?.data ?? {}) as Record<string, unknown>;
  const st = data[LOOP_STATE(loopId)] as { items: unknown[]; saved: { scope: string | null } };
  const count = st.items.length;
  data.item = st.items[i] ?? null;
  data.index = i;
  data.loop = { index: i, number: i + 1, count, first: i === 0, last: i === count - 1 };
  data.__scope = `${st.saved.scope ? `${st.saved.scope}/` : ""}${loopId}:${i}`;
  await db.from("run_contexts").update({ data }).eq("run_id", runId);
  const steps = (run.steps as StepRun[]).map((s) => (bodyIds.includes(s.nodeId) ? { ...s, status: "pending" as const, attempt: 0, attempts: [], startedAt: undefined, endedAt: undefined, errorCode: undefined, errorMessage: undefined, errorClass: undefined, output: undefined, input: undefined } : s));
  const loopStep = steps.find((s) => s.nodeId === loopId);
  await saveRun(runId, { steps, logs: [...(run.logs as LogEntry[]), log("info", `“${loopStep?.nodeLabel ?? "For each"}”: item ${i + 1} of ${count}.`, loopStep?.id, { index: i })] });
}

/** Restores the outer item/index (for nested loops) and drops the snapshot. */
export async function endLoop(runId: string, loopId: string) {
  const db = adminClient();
  const { data: ctxRow } = await db.from("run_contexts").select("data").eq("run_id", runId).single();
  const data = (ctxRow?.data ?? {}) as Record<string, unknown>;
  const st = data[LOOP_STATE(loopId)] as { items: unknown[]; saved: Record<string, unknown> } | undefined;
  if (st) {
    for (const k of ["item", "index", "loop"]) data[k] = st.saved[k] ?? null;
    if (st.saved.scope) data.__scope = st.saved.scope;
    else delete data.__scope;
    delete data[LOOP_STATE(loopId)];
    await db.from("run_contexts").update({ data }).eq("run_id", runId);
  }
}

/* ---------------- the durable workflow ---------------- */

/** The durable workflow (Inngest). Each attempt, timer and backoff is a memoized step; the order comes from lib/engine/walk.ts. */
export const runWorkflowFunction = inngest.createFunction(
  {
    id: "run-workflow",
    retries: 0,
    triggers: [{ event: RUN_REQUESTED }],
    cancelOn: [{ event: RUN_CANCELLED, if: "event.data.runId == async.data.runId" }],
    concurrency: [{ key: "event.data.runId", limit: 1 }],
  },
  async ({ event, step }) => {
    const { runId, pass = 0, resumeFromNodeId } = event.data as { runId: string; pass?: number; resumeFromNodeId?: string };
    const def = await step.run(`p${pass}:load`, async () => (await loadRun(runId)).def);
    const p = `p${pass}`;

    const walker = createWalker(def, {
      exec: async (node, sid) => {
        const id = node.id;
        if (node.kind === "delay") {
          await step.run(`${sid}:start`, () => markDelayStart(runId, id));
          await step.sleep(`${sid}:timer`, `${Math.max(1, node.config.amount * UNIT_SECONDS[node.config.unit])}s`);
          return step.run(`${sid}:a1`, () => runAttempt(runId, id, 1));
        }
        // An approved/manual retry of a failed step gets exactly one more attempt.
        const isResume = resumeFromNodeId === id && pass > 0;
        const max = isResume ? 1 : node.kind === "http" || node.kind === "action" ? Math.max(1, node.config.maxAttempts) : 1;
        let result: Awaited<ReturnType<typeof runAttempt>> = { ok: false };
        for (let a = 1; a <= max; a++) {
          result = await step.run(`${sid}:a${a}`, () => runAttempt(runId, id, isResume ? 0 : max));
          if (result.cancelled || result.ok || !result.retryInSec) break;
          await step.sleep(`${sid}:backoff${a}`, `${result.retryInSec}s`);
        }
        return result;
      },
      fail: (node, sid) => step.run(`${sid}:fail`, () => failRun(runId, node.id)),
      loopBegin: async (node, sid) => (await step.run(`${sid}:begin`, () => beginLoop(runId, node.id))).count,
      loopItem: async (node, i, sid, bodyIds) => { await step.run(`${sid}:set`, () => beginIteration(runId, node.id, i, bodyIds)); },
      loopEnd: async (node, sid) => { await step.run(`${sid}:end`, () => endLoop(runId, node.id)); },
    });

    // Retrying a step inside a loop restarts the outermost loop around it (per-item idempotency keys
    // stop external effects from repeating within the provider's window).
    const trigger = def.nodes.find((n) => n.kind === "trigger");
    const start = resumeFromNodeId ? walker.resumePoint(resumeFromNodeId) : trigger?.id;
    const outcome = await walker.walk(start ? [start] : [], `${p}:`, null);
    if (outcome === "cancelled") return { status: "cancelled" };
    if (outcome === "failed") return { status: "failed" };
    await step.run(`${p}:finish`, () => finishRun(runId));
    return { status: "succeeded" };
  },
);

export const KIND_LABEL = (k: WorkflowNode["kind"]) => NODE_META[k].label;
