import type { ApprovalStatus, ConnectionStatus, MemberStatus, RunStatus, StepStatus, WorkflowStatus } from "./types";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "primary";
export type StatusIcon =
  | "check" | "x" | "clock" | "spinner" | "pause" | "archive" | "pencil" | "ban" | "rotate" | "hand" | "dash" | "plug" | "alert" | "mail";

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: StatusIcon;
  description: string;
}

export const WORKFLOW_STATUS_META: Record<WorkflowStatus, StatusMeta> = {
  active: { label: "Active", tone: "success", icon: "check", description: "Published and accepting triggers." },
  draft: { label: "Draft", tone: "neutral", icon: "pencil", description: "Not yet published. Triggers are ignored." },
  paused: { label: "Paused", tone: "warning", icon: "pause", description: "Published, but new triggers are rejected until resumed." },
  archived: { label: "Archived", tone: "neutral", icon: "archive", description: "Read-only. Kept for history." },
};

/** Execution lifecycle from spec §07. */
export const RUN_STATUS_META: Record<RunStatus, StatusMeta> = {
  queued: { label: "Queued", tone: "neutral", icon: "clock", description: "Accepted and waiting to start." },
  running: { label: "Running", tone: "info", icon: "spinner", description: "Executing or waiting on a durable timer." },
  waiting_approval: { label: "Waiting for approval", tone: "warning", icon: "hand", description: "Paused pending an authorized decision." },
  retrying: { label: "Retrying", tone: "warning", icon: "rotate", description: "A step failed and is eligible for retry." },
  succeeded: { label: "Succeeded", tone: "success", icon: "check", description: "All required steps completed." },
  failed: { label: "Failed", tone: "danger", icon: "x", description: "Retry policy exhausted or a non-recoverable error occurred." },
  cancelled: { label: "Cancelled", tone: "neutral", icon: "ban", description: "The run was cancelled." },
};

export const STEP_STATUS_META: Record<StepStatus, StatusMeta> = {
  pending: { label: "Pending", tone: "neutral", icon: "clock", description: "Not started yet." },
  running: { label: "Running", tone: "info", icon: "spinner", description: "In progress." },
  retrying: { label: "Retrying", tone: "warning", icon: "rotate", description: "Waiting for the next attempt." },
  succeeded: { label: "Succeeded", tone: "success", icon: "check", description: "Completed." },
  failed: { label: "Failed", tone: "danger", icon: "x", description: "Failed." },
  skipped: { label: "Skipped", tone: "neutral", icon: "dash", description: "Not on the branch that ran." },
  cancelled: { label: "Cancelled", tone: "neutral", icon: "ban", description: "Cancelled before it ran." },
};

export const CONNECTION_STATUS_META: Record<ConnectionStatus, StatusMeta> = {
  connected: { label: "Connected", tone: "success", icon: "check", description: "Last connection test passed." },
  error: { label: "Error", tone: "danger", icon: "alert", description: "Last connection test failed." },
  untested: { label: "Not tested", tone: "neutral", icon: "clock", description: "Run a connection test before using it." },
  revoked: { label: "Revoked", tone: "neutral", icon: "ban", description: "Credentials revoked. Steps using it will fail." },
};

export const MEMBER_STATUS_META: Record<MemberStatus, StatusMeta> = {
  active: { label: "Active", tone: "success", icon: "check", description: "Has joined the workspace." },
  invited: { label: "Invited", tone: "info", icon: "mail", description: "Invitation sent, not yet accepted." },
  suspended: { label: "Suspended", tone: "neutral", icon: "ban", description: "Access suspended." },
};

export const APPROVAL_STATUS_META: Record<ApprovalStatus, StatusMeta> = {
  pending: { label: "Pending", tone: "warning", icon: "hand", description: "Waiting for an authorized approver." },
  approved: { label: "Approved", tone: "success", icon: "check", description: "Approved and dispatched." },
  rejected: { label: "Rejected", tone: "danger", icon: "x", description: "Rejected by an approver." },
  expired: { label: "Expired", tone: "neutral", icon: "clock", description: "No decision before the expiry time." },
};

export const ACTIVE_RUN_STATUSES: RunStatus[] = ["queued", "running", "waiting_approval", "retrying"];
export const CANCELLABLE_RUN_STATUSES: RunStatus[] = ["queued", "running", "waiting_approval", "retrying"];
