import "server-only";
import { DEFAULT_GRANTS } from "@/lib/domain/permissions";
import type {
  AiAnalysis, ApiKey, AppNotification, ApprovalRequest, AuditEvent, Connection, Member, WebhookDelivery, WebhookEndpoint, Workflow, WorkflowRun, WorkflowVersion, Workspace,
} from "@/lib/domain/types";

 
type Row = Record<string, any>;

export const DEFAULT_SETTINGS: Workspace["settings"] = {
  timezone: "UTC",
  retentionDays: 30,
  payloadStorage: "redacted",
  defaultRetry: { maxAttempts: 3, initialIntervalSec: 2, backoffCoefficient: 2, maxIntervalSec: 60 },
  aiAssistantEnabled: true,
  approvalExpiryHours: 24,
};

export const toWorkspace = (r: Row): Workspace => ({
  id: r.id, name: r.name, slug: r.slug, plan: r.plan, createdBy: r.created_by, createdAt: r.created_at,
  settings: { ...DEFAULT_SETTINGS, ...(r.settings ?? {}) }, grants: { ...DEFAULT_GRANTS, ...(r.grants ?? {}) },
  quotas: r.quotas ?? { executionsPerMonth: 1000, members: 10, connections: 10 },
});

export const toMember = (r: Row): Member => ({
  id: r.id, workspaceId: r.workspace_id, userId: r.user_id, name: r.name ?? "", email: r.email, role: r.role, status: r.status,
  invitedBy: r.invited_by ?? undefined, invitedAt: r.invited_at ?? undefined, joinedAt: r.joined_at ?? undefined, lastActiveAt: r.last_active_at ?? undefined,
});

export const toWorkflow = (r: Row): Workflow => ({
  id: r.id, workspaceId: r.workspace_id, name: r.name, description: r.description, status: r.status, ownerId: r.owner_id, tags: r.tags ?? [],
  createdAt: r.created_at, updatedAt: r.updated_at, draft: r.draft, draftUpdatedAt: r.draft_updated_at, draftRevision: r.draft_revision,
  currentVersionId: r.current_version_id, failureInjection: "none",
});

export const toVersion = (r: Row): WorkflowVersion => ({
  id: r.id, workspaceId: r.workspace_id, workflowId: r.workflow_id, version: r.version, definition: r.definition, checksum: r.checksum,
  publishedAt: r.published_at, publishedBy: r.published_by, changeNote: r.change_note,
});

export const toRun = (r: Row): WorkflowRun => ({
  id: r.id, workspaceId: r.workspace_id, workflowId: r.workflow_id, workflowName: r.workflow_name, workflowVersionId: r.workflow_version_id,
  version: r.version, temporalWorkflowId: `inngest:${r.id}`, correlationId: r.correlation_id, status: r.status, trigger: r.trigger,
  input: r.input, startedAt: r.started_at, endedAt: r.ended_at ?? undefined, steps: r.steps ?? [], logs: r.logs ?? [], exception: r.exception ?? undefined,
});

export const toConnection = (r: Row): Connection => ({
  id: r.id, workspaceId: r.workspace_id, integrationId: r.integration_id, displayName: r.display_name, status: r.status,
  secretRef: `db://connection_secrets/${r.id}`, secretHint: r.secret_hint, config: r.config ?? {}, createdAt: r.created_at, createdBy: r.created_by,
  lastTestedAt: r.last_tested_at ?? undefined, lastError: r.last_error ?? undefined, rotatedAt: r.rotated_at ?? undefined,
});

export const toWebhook = (r: Row): WebhookEndpoint => ({
  id: r.id, workspaceId: r.workspace_id, workflowId: r.workflow_id, name: r.name, status: r.status, signingSecretRef: `db://webhook_secrets/${r.id}`,
  secretHint: r.secret_hint, replayWindowSec: r.replay_window_sec, maxBodyKb: r.max_body_kb, rateLimitPerMin: r.rate_limit_per_min, verification: r.verification === "url_key" ? "url_key" : "hmac", createdAt: r.created_at,
  rotatedAt: r.rotated_at ?? undefined,
});

export const toDelivery = (r: Row): WebhookDelivery => ({
  id: r.id, workspaceId: r.workspace_id, endpointId: r.endpoint_id, receivedAt: r.received_at, eventId: r.event_id, status: r.status,
  httpStatus: r.http_status, bytes: r.bytes, runId: r.run_id ?? undefined,
});

export const toAnalysis = (r: Row): AiAnalysis => ({ ...(r.data as AiAnalysis), id: r.id, workspaceId: r.workspace_id, runId: r.run_id, stepId: r.step_id, createdAt: r.created_at, createdBy: r.created_by });

export const toApproval = (r: Row): ApprovalRequest => ({
  id: r.id, workspaceId: r.workspace_id, runId: r.run_id, stepId: r.step_id, workflowName: r.workflow_name, analysisId: r.analysis_id ?? undefined,
  actionType: r.action_type, toolCall: r.tool_call, rationale: r.rationale, status: r.status, requestedBy: r.requested_by, requestedAt: r.requested_at,
  expiresAt: r.expires_at, decidedBy: r.decided_by ?? undefined, decidedByName: r.decided_by_name ?? undefined, decidedAt: r.decided_at ?? undefined,
  decisionReason: r.decision_reason ?? undefined, outcome: r.outcome ?? undefined,
});

export const toApiKey = (r: Row): ApiKey => ({
  id: r.id, workspaceId: r.workspace_id, name: r.name, prefix: r.prefix, hint: r.hint, scopes: r.scopes, createdAt: r.created_at, createdBy: r.created_by,
  lastUsedAt: r.last_used_at ?? undefined, expiresAt: r.expires_at ?? undefined, status: r.status,
});

export const toAudit = (r: Row): AuditEvent => ({
  id: r.id, workspaceId: r.workspace_id, actor: r.actor, action: r.action, category: r.category, resourceType: r.resource_type,
  resourceId: r.resource_id, resourceName: r.resource_name, createdAt: r.created_at, metadata: r.metadata ?? {},
});

export const toNotification = (r: Row): AppNotification => ({ id: r.id, workspaceId: r.workspace_id, kind: r.kind, title: r.title, body: r.body, href: r.href, createdAt: r.created_at, read: r.read });
