import { uid } from "@/lib/utils";
import type { LogEntry, StepRun, WorkflowDefinition, WorkflowNode } from "./types";

/**
 * Pure rules about runs and their steps, shared by the run service, the approval flow and the worker.
 * Nothing here touches storage or the clock beyond what is passed in.
 */

/** A structured run-log line. */
export function runLog(level: LogEntry["level"], message: string, stepId?: string, fields?: LogEntry["fields"]): LogEntry {
  return { id: uid("log", 8), ts: new Date().toISOString(), level, message, stepId, fields };
}

/** Nodes in execution order: breadth-first from the trigger, then anything unreachable. */
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

/** One pending step record per node, in execution order. */
export function plannedSteps(def: WorkflowDefinition, runId = ""): StepRun[] {
  return orderNodes(def).map((n) => ({ id: uid("step", 10), runId, nodeId: n.id, nodeLabel: n.label, nodeKind: n.kind, status: "pending", attempt: 0, attempts: [] }));
}

/**
 * Why retrying this step can't succeed, or null if a retry is worth trying. The same rule applies to a
 * manual retry and to an AI-recommended one.
 */
export function retryBlockReason(step: Pick<StepRun, "errorClass">): string | null {
  if (step.errorClass === "permission") return "Fix the connection first. Retrying with the same credential will fail again.";
  if (step.errorClass === "validation") return "This step failed validation. Retrying with the same input will fail again.";
  return null;
}

/** Marks one step as retrying so the worker can resume from it. */
export function stepsForResume(steps: StepRun[], stepId: string): StepRun[] {
  return steps.map((s) => (s.id === stepId ? { ...s, status: "retrying" as const, endedAt: undefined } : s));
}

/** Cancels every unfinished step; in-flight ones get an end time. */
export function stepsForCancel(steps: StepRun[], now: string): StepRun[] {
  return steps.map((s) => (s.status === "running" || s.status === "retrying" || s.status === "pending" ? { ...s, status: "cancelled" as const, endedAt: s.status === "pending" ? undefined : now } : s));
}

/** Pending steps that never ran are skipped once the run succeeds. */
export function stepsForSuccess(steps: StepRun[]): StepRun[] {
  return steps.map((s) => (s.status === "pending" ? { ...s, status: "skipped" as const } : s));
}

/** Clears a loop body's step records so each item gets fresh attempts. */
export function stepsForIteration(steps: StepRun[], bodyIds: string[]): StepRun[] {
  return steps.map((s) =>
    bodyIds.includes(s.nodeId)
      ? { ...s, status: "pending" as const, attempt: 0, attempts: [], startedAt: undefined, endedAt: undefined, errorCode: undefined, errorMessage: undefined, errorClass: undefined, output: undefined, input: undefined }
      : s,
  );
}

/** Wall-clock duration of a finished run, or null while it's still going. */
export function durationMs(startedAt: string, endedAt?: string | null): number | null {
  return endedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : null;
}

/** Start of the current calendar month in UTC (the window for monthly execution quotas). */
export function monthStartUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
