/**
 * Mock AI exception advisor (spec §08).
 *
 * In production this is a LangGraph service with restricted tools. Here it is a deterministic
 * function over *sanitized* evidence so the UI and the policy layer can be exercised offline.
 *
 * Boundaries enforced in this module, mirroring the spec:
 *  - Evidence is an allowlisted set of fields from the run; payloads are already redacted.
 *  - Recommendations come from a fixed action catalogue (AI_ACTION_TYPES). Anything else is rejected.
 *  - The policy check is deterministic code, not model output. Model confidence is never the
 *    sole safety signal.
 */
import { can } from "@/lib/domain/permissions";
import type {
  AiActionType,
  AiAnalysis,
  Connection,
  ErrorClass,
  Integration,
  Role,
  RoleGrants,
  StepRun,
  WorkflowNode,
  WorkflowRun,
} from "@/lib/domain/types";
import { AI_ACTION_TYPES } from "@/lib/domain/types";

export const AI_MODEL = "mock-advisor-1 (local)";
export const AI_PROMPT_VERSION = "exception-triage@2026-10-14";

export interface AdvisorInput {
  run: WorkflowRun;
  step: StepRun;
  node?: WorkflowNode;
  integrations: Integration[];
  connections: Connection[];
  actor: { id: string; role: Role };
  grants: RoleGrants;
  aiEnabled: boolean;
}

export type AdvisorOutput = Omit<AiAnalysis, "id" | "workspaceId" | "createdAt" | "createdBy">;

/** Steps shown in the UI while the advisor "works". Mirrors spec §08 AI flow steps 1–4. */
export const ADVISOR_STAGES = [
  "Collecting sanitized evidence",
  "Classifying the failure",
  "Matching the action catalogue",
  "Running the policy check",
] as const;

function classify(step: StepRun): ErrorClass {
  if (step.errorClass) return step.errorClass;
  const code = step.errorCode ?? "";
  if (/TIMEOUT|5\d\d|UNAVAILABLE|RATE_LIMIT/.test(code)) return "transient";
  if (/401|403|AUTH|PERMISSION/.test(code)) return "permission";
  if (/VALIDATION|MISSING|SCHEMA|400|422/.test(code)) return "validation";
  if (/CONFIG|NOT_FOUND|404/.test(code)) return "configuration";
  return "unknown";
}

export function analyzeFailure(input: AdvisorInput): AdvisorOutput {
  const { run, step, node } = input;
  const cls = classify(step);
  const attempts = step.attempts.length;
  const lastAttempt = step.attempts[attempts - 1];
  const sameKey = attempts > 1 && step.attempts.every((a) => a.idempotencyKey === step.attempts[0]!.idempotencyKey);
  const integration =
    node?.kind === "action" ? input.integrations.find((i) => i.id === node.config.integrationId) : node?.kind === "http" ? input.integrations.find((i) => i.id === "int_http") : undefined;
  const action = node?.kind === "action" ? integration?.actions.find((a) => a.key === node.config.actionKey) : undefined;
  const connection =
    node && (node.kind === "action" || node.kind === "http") ? input.connections.find((c) => c.id === node.config.connectionId) : undefined;

  const evidence: AiAnalysis["evidence"] = [
    { label: "Failed step", source: `step_runs.${step.id}`, value: `${step.nodeLabel} (${step.nodeKind})` },
    { label: "Error code", source: `step_runs.${step.id}.error_code`, value: step.errorCode ?? "UNKNOWN" },
    { label: "Error message", source: `step_runs.${step.id}.error_message`, value: step.errorMessage ?? "No message recorded" },
    { label: "Attempts", source: `step_runs.${step.id}.attempt`, value: `${attempts} attempt${attempts === 1 ? "" : "s"} made${sameKey ? ", all with the same idempotency key" : ""}` },
  ];
  if (lastAttempt?.idempotencyKey) evidence.push({ label: "Idempotency key", source: "activity.headers", value: lastAttempt.idempotencyKey });
  if (action) evidence.push({ label: "Connector contract", source: `connectors.${integration!.id}.${action.key}`, value: `${action.idempotent ? "Idempotent" : "Not idempotent"}, ${action.retryable ? "retryable" : "not retryable"}, ${action.timeoutSec}s timeout` });
  if (connection) evidence.push({ label: "Connection status", source: `connections.${connection.id}.status`, value: `${connection.displayName}: ${connection.status}` });
  evidence.push({ label: "Workflow version", source: `workflow_runs.${run.id}.workflow_version_id`, value: `v${run.version} (pinned)` });

  let actionType: AiActionType;
  let title: string;
  let description: string;
  let rootCause: string;
  let explanation: string;
  let summary: string;
  let confidence: AiAnalysis["confidence"];
  const effects: string[] = [];
  const alternatives: AiAnalysis["alternatives"] = [];

  switch (cls) {
    case "transient": {
      const safe = action ? action.idempotent : node?.kind === "http" ? node.config.useIdempotencyKey : false;
      summary = `${step.nodeLabel} timed out ${attempts} time${attempts === 1 ? "" : "s"}; the provider looks temporarily unavailable.`;
      explanation = `Every attempt failed with ${step.errorCode} before the provider answered, and the retry policy (${attempts} attempts) is exhausted. Earlier steps succeeded, so their side effects are already committed and won't be repeated.`;
      rootCause = `The ${integration?.name ?? "external"} endpoint exceeded the start-to-close timeout. This pattern usually means the provider was degraded, not that the request was wrong.`;
      if (safe) {
        actionType = "retry_failed_step";
        title = `Retry “${step.nodeLabel}” once`;
        description = "Re-run only the failed step with the same idempotency key. If the provider had accepted an earlier attempt, it will return the original result instead of creating a duplicate.";
        effects.push(`Resumes run ${run.id} from “${step.nodeLabel}”.`, `Reuses idempotency key ${lastAttempt?.idempotencyKey ?? "—"}.`, "Remaining steps continue on the same pinned version.");
        confidence = sameKey ? "high" : "medium";
        alternatives.push({ title: "Check provider status first", description: "If the provider reports an incident, wait for recovery before approving." });
      } else {
        actionType = "no_action";
        title = "Reconcile before retrying";
        description = "This action isn't idempotent, so a blind retry could duplicate the side effect. Check the provider for the original request before re-running.";
        effects.push("No automatic action. An operator must reconcile manually.");
        confidence = "medium";
      }
      break;
    }
    case "permission": {
      summary = `${connection?.displayName ?? "The connection"} was rejected by the provider.`;
      explanation = `The provider returned an authorization error. Retrying with the same credential will fail again, so retries were not attempted.`;
      rootCause = `The stored credential for ${connection?.displayName ?? "this connection"} is expired, revoked or missing a required scope${action ? ` (${action.scopes.join(", ")})` : ""}.`;
      actionType = "reconnect_credential";
      title = `Reconnect “${connection?.displayName ?? "connection"}”`;
      description = "An administrator should rotate the credential and run a connection test. After that, retry the failed step.";
      effects.push("Opens credential configuration. The assistant can't read or change secrets.", "Credential changes always require a person.");
      confidence = "high";
      alternatives.push({ title: "Switch to another connection", description: "Edit the draft to use a different connection, then publish a new version." });
      break;
    }
    case "validation": {
      summary = `The run input is missing data that “${step.nodeLabel}” requires.`;
      explanation = "The failure happened before any external call, so nothing needs to be undone. Retrying with the same input will fail the same way.";
      rootCause = step.errorMessage ?? "Input failed validation.";
      actionType = "correct_field";
      title = "Fix the payload mapping or the sender";
      description = "Update the upstream sender to include the field, or add a transform with a fallback value in a new draft version. Then replay the event.";
      effects.push("Opens the workflow editor at the failing step. No run is changed.");
      confidence = "medium";
      break;
    }
    default: {
      summary = `“${step.nodeLabel}” failed with an unrecognized error.`;
      explanation = "There isn't enough evidence to recommend an automated action.";
      rootCause = step.errorMessage ?? "Unknown.";
      actionType = "no_action";
      title = "Investigate manually";
      description = "Review the logs and provider dashboard. Escalate to the integration owner if the error repeats.";
      effects.push("No automatic action.");
      confidence = "low";
    }
  }

  const toolCall: { name: string; args: Record<string, string> } =
    actionType === "retry_failed_step"
      ? { name: "retry_failed_step", args: { run_id: run.id, step_id: step.id } }
      : actionType === "reconnect_credential"
        ? { name: "open_credential_settings", args: { connection_id: connection?.id ?? "unknown" } }
        : actionType === "correct_field"
          ? { name: "open_workflow_editor", args: { workflow_id: run.workflowId, node_id: step.nodeId } }
          : { name: "none", args: {} };

  const policy = checkPolicy({ actionType, actor: input.actor, grants: input.grants, aiEnabled: input.aiEnabled, run, step });
  return {
    runId: run.id,
    stepId: step.id,
    model: AI_MODEL,
    promptVersion: AI_PROMPT_VERSION,
    classification: cls,
    confidence,
    summary,
    explanation,
    rootCause,
    evidence,
    recommendation: { actionType, title, description, consequential: actionType === "retry_failed_step", toolCall, effects },
    alternatives,
    policy,
  };
}

/**
 * Deterministic server-side policy (spec §08 step 4). Model output is untrusted: the action type
 * must be in the catalogue, the target must belong to the run, and the actor needs permission.
 */
export function checkPolicy(p: {
  actionType: string;
  actor: { role: Role };
  grants: RoleGrants;
  aiEnabled: boolean;
  run: WorkflowRun;
  step: StepRun;
}): AiAnalysis["policy"] {
  const reasons: string[] = [];
  if (!p.aiEnabled) reasons.push("The AI assistant is turned off for this workspace.");
  if (!(AI_ACTION_TYPES as readonly string[]).includes(p.actionType)) {
    reasons.push(`“${p.actionType}” isn't in the action catalogue.`);
    return { allowed: false, requiresApproval: true, reasons };
  }
  if (p.step.runId !== p.run.id) reasons.push("The target step doesn't belong to this run.");
  if (p.actionType === "retry_failed_step") {
    if (p.step.status !== "failed") reasons.push("Only a failed step can be retried.");
    if (p.run.status !== "failed" && p.run.status !== "waiting_approval") reasons.push("The run is not in a recoverable state.");
    reasons.push("Retries are consequential: an authorized approver must approve before dispatch.");
    const allowed = reasons.length === 1 && p.aiEnabled;
    return { allowed, requiresApproval: true, reasons };
  }
  if (p.actionType === "reconnect_credential") reasons.push("Credential changes are never automated. A person must complete them in credential settings.");
  if (p.actionType === "correct_field") reasons.push("Definition changes go through a new draft and publish, not through the assistant.");
  return { allowed: p.aiEnabled, requiresApproval: false, reasons };
}

export function canDecideApproval(role: Role, grants: RoleGrants) {
  return can(role, "approvals.decide", grants);
}
