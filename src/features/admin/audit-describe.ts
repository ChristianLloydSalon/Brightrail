import type { AuditEvent } from "@/lib/domain/types";

const VERBS: Record<string, string> = {
  "auth.sign_in": "signed in",
  "auth.password_reset": "reset their password",
  "auth.password_changed": "changed their password",
  "workflow.created": "created workflow",
  "workflow.updated": "updated details of",
  "workflow.draft_saved": "saved a draft of",
  "workflow.validated": "validated",
  "workflow.published": "published",
  "workflow.paused": "paused",
  "workflow.resumed": "resumed",
  "workflow.archived": "archived",
  "run.triggered": "started a run of",
  "run.failed": "reported a failed run of",
  "run.cancelled": "cancelled a run of",
  "run.step_retried": "retried a failed step in",
  "ai.analysis_requested": "requested an AI failure analysis for",
  "approval.requested": "requested approval to recover",
  "approval.approved": "approved a recovery action for",
  "approval.rejected": "rejected a recovery action for",
  "approval.expired": "expired an unanswered approval request for",
  "connection.created": "created connection",
  "connection.updated": "updated connection",
  "connection.tested": "tested connection",
  "connection.rotated": "rotated credentials for",
  "connection.revoked": "revoked connection",
  "member.invited": "invited",
  "member.joined": "joined as",
  "member.invite_resent": "resent the invitation to",
  "member.invite_revoked": "revoked the invitation for",
  "member.role_changed": "changed the role of",
  "member.suspended": "suspended",
  "member.reactivated": "reactivated",
  "member.removed": "removed",
  "member.account_deleted": "deleted the account of",
  "workspace.created": "created workspace",
  "workspace.settings_updated": "updated settings of",
  "workspace.grants_updated": "changed role permissions in",
  "workspace.ownership_transferred": "transferred ownership of",
  "workspace.plan_changed": "changed the plan of",
  "apikey.created": "created API key",
  "apikey.revoked": "revoked API key",
  "webhook.created": "created webhook endpoint",
  "webhook.updated": "updated webhook endpoint",
  "webhook.secret_rotated": "rotated the secret of",
  "webhook.test_sent": "sent a test event to",
};

export function describeAudit(e: AuditEvent): string {
  const verb = VERBS[e.action] ?? e.action.replace(/[._]/g, " ");
  if (e.action === "auth.sign_in" || e.action.startsWith("auth.password")) return verb;
  let extra = "";
  if (e.action === "workflow.published" && e.metadata.version) extra = ` (v${e.metadata.version})`;
  if (e.action === "member.role_changed") extra = ` from ${e.metadata.from} to ${e.metadata.to}`;
  if (e.action === "member.invited" && e.metadata.role) extra = ` as ${e.metadata.role}`;
  if (e.action === "connection.tested" && e.metadata.result) extra = ` (${e.metadata.result})`;
  return `${verb} ${e.resourceName}${extra}`;
}

export const AUDIT_CATEGORY_LABELS: Record<AuditEvent["category"], string> = {
  auth: "Authentication",
  workflow: "Workflows",
  run: "Runs",
  approval: "AI & approvals",
  connection: "Connections",
  member: "Members",
  workspace: "Workspace",
  apikey: "API keys",
  webhook: "Webhooks",
};
