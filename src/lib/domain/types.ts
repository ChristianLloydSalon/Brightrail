/**
 * FlowForge domain model.
 * Mirrors the entities in spec §09 (Data model). Field names are camelCase on the client;
 * the API layer is responsible for mapping to snake_case columns.
 */

export type ID = string;
export type ISODate = string;

/* ---------- Identity & tenancy ---------- */

export const ROLES = ["owner", "admin", "editor", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface User {
  id: ID;
  name: string;
  email: string;
  title?: string;
  createdAt: ISODate;
}

export interface RetryPolicy {
  maxAttempts: number;
  initialIntervalSec: number;
  backoffCoefficient: number;
  maxIntervalSec: number;
}

export interface WorkspaceSettings {
  timezone: string;
  retentionDays: number;
  payloadStorage: "redacted" | "minimal";
  defaultRetry: RetryPolicy;
  aiAssistantEnabled: boolean;
  approvalExpiryHours: number;
}

export interface Workspace {
  id: ID;
  name: string;
  slug: string;
  plan: "free" | "team";
  createdBy: ID;
  createdAt: ISODate;
  settings: WorkspaceSettings;
  /** Configurable grants per role (spec §11: "publish if granted", "assigned approvals"). */
  grants: RoleGrants;
  quotas: { executionsPerMonth: number; members: number; connections: number };
}

export type MemberStatus = "active" | "invited" | "suspended";

export interface Member {
  id: ID;
  workspaceId: ID;
  userId: ID | null;
  name: string;
  email: string;
  role: Role;
  status: MemberStatus;
  invitedBy?: ID;
  invitedAt?: ISODate;
  joinedAt?: ISODate;
  lastActiveAt?: ISODate;
}

/* ---------- Permissions ---------- */

export const PERMISSIONS = [
  "workflows.view",
  "workflows.edit",
  "workflows.publish",
  "runs.view",
  "runs.trigger",
  "runs.retry",
  "runs.cancel",
  "approvals.decide",
  "connections.view",
  "connections.manage",
  "members.view",
  "members.manage",
  "workspace.manage",
  "apikeys.manage",
  "audit.view",
  "workspace.delete",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Grants that a workspace owner/admin may toggle for non-admin roles. */
export const CONFIGURABLE_GRANTS = [
  { role: "editor", permission: "workflows.publish" },
  { role: "editor", permission: "runs.retry" },
  { role: "operator", permission: "approvals.decide" },
  { role: "viewer", permission: "audit.view" },
] as const satisfies ReadonlyArray<{ role: Role; permission: Permission }>;

export type GrantKey = `${(typeof CONFIGURABLE_GRANTS)[number]["role"]}:${(typeof CONFIGURABLE_GRANTS)[number]["permission"]}`;
export type RoleGrants = Partial<Record<GrantKey, boolean>>;

/* ---------- Workflows ---------- */

export const WORKFLOW_STATUSES = ["active", "draft", "paused", "archived"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const NODE_KINDS = ["trigger", "http", "action", "condition", "loop", "formula", "delay", "transform", "errorHandler"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TriggerConfig {
  triggerType: "manual" | "webhook" | "schedule";
  /** Schedule trigger only. */
  schedule?: import("@/lib/engine/schedule").ScheduleSpec;
  eventName?: string;
  webhookEndpointId?: ID;
  /** JSON schema-ish list of required payload fields */
  requiredFields: string[];
}
export interface HttpConfig {
  method: HttpMethod;
  url: string;
  connectionId?: ID;
  headers: Array<{ key: string; value: string }>;
  body?: string;
  timeoutSec: number;
  maxAttempts: number;
  useIdempotencyKey: boolean;
}
export interface ActionConfig {
  integrationId?: ID;
  connectionId?: ID;
  actionKey?: string;
  inputMapping: Array<{ field: string; source: string }>;
  timeoutSec: number;
  maxAttempts: number;
}
export type ConditionOperator = "equals" | "not_equals" | "greater_than" | "less_than" | "contains" | "exists";
export interface ConditionConfig {
  field: string;
  operator: ConditionOperator;
  value: string;
}
export interface DelayConfig {
  amount: number;
  unit: "seconds" | "minutes" | "hours" | "days";
}
export type TransformFn = "copy" | "uppercase" | "lowercase" | "to_number" | "to_string" | "trim" | "default";
export interface TransformConfig {
  mappings: Array<{ target: string; source: string; fn: TransformFn; fallback?: string }>;
}
export interface ErrorHandlerConfig {
  strategy: "create_exception" | "notify" | "fallback_path" | "fail_run";
  notifyChannel?: string;
  /** Error classes this handler catches */
  catches: Array<"timeout" | "http_5xx" | "http_4xx" | "validation" | "any">;
}

/** For each: runs the steps on its "each" output once per item of a list, then continues on "Next". */
export interface LoopConfig {
  /** Field path of the list, e.g. order.items */
  field: string;
  /** Safety cap; extra items are skipped (logged). */
  maxItems: number;
}
/** Formula: sets fields from safe expressions (see lib/engine/formula.ts). Evaluated top to bottom. */
export interface FormulaConfig {
  assignments: Array<{ target: string; expression: string }>;
}

export type NodeConfigMap = {
  loop: LoopConfig;
  formula: FormulaConfig;
  trigger: TriggerConfig;
  http: HttpConfig;
  action: ActionConfig;
  condition: ConditionConfig;
  delay: DelayConfig;
  transform: TransformConfig;
  errorHandler: ErrorHandlerConfig;
};

export type WorkflowNode = {
  [K in NodeKind]: {
    id: ID;
    kind: K;
    position: { x: number; y: number };
    label: string;
    description?: string;
    config: NodeConfigMap[K];
  };
}[NodeKind];

export type NodeOf<K extends NodeKind> = Extract<WorkflowNode, { kind: K }>;

/** "default" for normal flow, "true"/"false" for condition branches, "error" for error routing */
export type EdgeHandle = "default" | "true" | "false" | "error" | "each";

export interface WorkflowEdge {
  id: ID;
  source: ID;
  target: ID;
  sourceHandle: EdgeHandle;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type FailureInjection = "none" | "timeout_once" | "timeout_exhaust";

export interface Workflow {
  id: ID;
  workspaceId: ID;
  name: string;
  description: string;
  status: WorkflowStatus;
  ownerId: ID;
  tags: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
  draft: WorkflowDefinition;
  draftUpdatedAt: ISODate;
  /** Monotonic counter for optimistic concurrency on the draft */
  draftRevision: number;
  currentVersionId: ID | null;
  /** Reserved for sandbox testing; always "none" with real providers. */
  failureInjection: FailureInjection;
}

export interface WorkflowVersion {
  id: ID;
  workspaceId: ID;
  workflowId: ID;
  version: number;
  definition: WorkflowDefinition;
  checksum: string;
  publishedAt: ISODate;
  publishedBy: ID;
  changeNote: string;
}

/* ---------- Executions ---------- */

export const RUN_STATUSES = ["queued", "running", "waiting_approval", "retrying", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type StepStatus = "pending" | "running" | "retrying" | "succeeded" | "failed" | "skipped" | "cancelled";

export interface StepAttempt {
  attempt: number;
  status: "succeeded" | "failed" | "running";
  startedAt: ISODate;
  endedAt?: ISODate;
  errorCode?: string;
  errorMessage?: string;
  idempotencyKey: string;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface StepRun {
  id: ID;
  runId: ID;
  nodeId: ID;
  nodeLabel: string;
  nodeKind: NodeKind;
  status: StepStatus;
  attempt: number;
  startedAt?: ISODate;
  endedAt?: ISODate;
  errorCode?: string;
  errorMessage?: string;
  errorClass?: ErrorClass;
  input?: JsonValue;
  output?: JsonValue;
  attempts: StepAttempt[];
  branch?: "true" | "false";
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface LogEntry {
  id: ID;
  ts: ISODate;
  level: LogLevel;
  stepId?: ID;
  message: string;
  fields?: Record<string, string | number | boolean>;
}

export type TriggerSource = "manual" | "webhook" | "schedule" | "retry" | "ai_recovery";

export type ErrorClass = "transient" | "configuration" | "validation" | "permission" | "unknown";

export interface WorkflowRun {
  id: ID;
  workspaceId: ID;
  workflowId: ID;
  workflowName: string;
  workflowVersionId: ID;
  version: number;
  temporalWorkflowId: string;
  correlationId: string;
  status: RunStatus;
  trigger: { source: TriggerSource; actorId?: ID; detail: string };
  input: JsonValue;
  startedAt: ISODate;
  endedAt?: ISODate;
  steps: StepRun[];
  logs: LogEntry[];
  exception?: { status: "open" | "resolved"; openedAt: ISODate; resolvedAt?: ISODate };
  /** Remaining plan the simulated worker executes (mock engine only). */
  plan?: PlannedStep[];
  failureInjection?: FailureInjection;
}

export interface PlannedStep {
  nodeId: ID;
  outcome: "succeed" | "fail_once" | "fail_exhaust" | "fail_terminal" | "skip";
  errorCode?: string;
  errorMessage?: string;
  errorClass?: ErrorClass;
  branch?: "true" | "false";
  input?: JsonValue;
  output?: JsonValue;
  maxAttempts: number;
}

/* ---------- AI exception assistant & approvals ---------- */

export const AI_ACTION_TYPES = ["retry_failed_step", "reconnect_credential", "correct_field", "no_action"] as const;
export type AiActionType = (typeof AI_ACTION_TYPES)[number];

export interface AiEvidence {
  label: string;
  source: string;
  value: string;
}

export interface AiAnalysis {
  id: ID;
  workspaceId: ID;
  runId: ID;
  stepId: ID;
  createdAt: ISODate;
  createdBy: ID;
  model: string;
  promptVersion: string;
  classification: ErrorClass;
  confidence: "low" | "medium" | "high";
  summary: string;
  explanation: string;
  rootCause: string;
  evidence: AiEvidence[];
  recommendation: {
    actionType: AiActionType;
    title: string;
    description: string;
    consequential: boolean;
    toolCall: { name: string; args: Record<string, string> };
    effects: string[];
  };
  alternatives: Array<{ title: string; description: string }>;
  policy: { allowed: boolean; requiresApproval: boolean; reasons: string[] };
  approvalRequestId?: ID;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  id: ID;
  workspaceId: ID;
  runId: ID;
  stepId: ID;
  workflowName: string;
  analysisId?: ID;
  actionType: AiActionType;
  toolCall: { name: string; args: Record<string, string> };
  rationale: string;
  status: ApprovalStatus;
  requestedBy: { type: "ai" | "user"; id: ID; name: string };
  requestedAt: ISODate;
  expiresAt: ISODate;
  decidedBy?: ID;
  decidedByName?: string;
  decidedAt?: ISODate;
  decisionReason?: string;
  outcome?: "resolved" | "still_failing" | "pending";
}

/* ---------- Integrations ---------- */

export type IntegrationCategory = "Core" | "Payments" | "Commerce" | "Finance" | "Communication" | "Data";

export interface ConfigField {
  key: string;
  label: string;
  type: "text" | "url" | "secret" | "select";
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
}

export interface IntegrationAction {
  key: string;
  name: string;
  description: string;
  idempotent: boolean;
  retryable: boolean;
  timeoutSec: number;
  scopes: string[];
  sensitiveFields: string[];
  outputFields: string[];
}

export interface Integration {
  id: ID;
  name: string;
  vendor: string;
  category: IntegrationCategory;
  summary: string;
  description: string;
  availability: "available" | "planned";
  authType: "api_key" | "bearer" | "basic" | "none" | "signing_secret";
  configFields: ConfigField[];
  actions: IntegrationAction[];
  docs: string[];
}

export type ConnectionStatus = "connected" | "error" | "untested" | "revoked";

export interface Connection {
  id: ID;
  workspaceId: ID;
  integrationId: ID;
  displayName: string;
  status: ConnectionStatus;
  /** Reference into the secret manager; secret material never reaches the browser. */
  secretRef: string;
  secretHint: string;
  config: Record<string, string>;
  createdAt: ISODate;
  createdBy: ID;
  lastTestedAt?: ISODate;
  lastError?: string;
  rotatedAt?: ISODate;
}

export interface WebhookEndpoint {
  id: ID;
  workspaceId: ID;
  workflowId: ID;
  name: string;
  status: "active" | "disabled";
  signingSecretRef: string;
  secretHint: string;
  replayWindowSec: number;
  maxBodyKb: number;
  rateLimitPerMin: number;
  /** "hmac": senders sign each request (developers). "url_key": the secret is part of the URL (form tools, no-code apps). */
  verification: "hmac" | "url_key";
  createdAt: ISODate;
  rotatedAt?: ISODate;
}

export interface WebhookDelivery {
  id: ID;
  workspaceId: ID;
  endpointId: ID;
  receivedAt: ISODate;
  eventId: string;
  status: "accepted" | "duplicate" | "rejected_signature" | "rejected_replay" | "rejected_size" | "rejected_rate";
  httpStatus: number;
  bytes: number;
  runId?: ID;
}

/* ---------- Admin ---------- */

export const API_KEY_SCOPES = ["workflows:read", "workflows:write", "runs:read", "runs:trigger", "webhooks:manage", "audit:read"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface ApiKey {
  id: ID;
  workspaceId: ID;
  name: string;
  prefix: string;
  hint: string;
  scopes: ApiKeyScope[];
  createdAt: ISODate;
  createdBy: ID;
  lastUsedAt?: ISODate;
  expiresAt?: ISODate;
  status: "active" | "revoked";
}

export type AuditCategory = "auth" | "workflow" | "run" | "approval" | "connection" | "member" | "workspace" | "apikey" | "webhook";

export interface AuditEvent {
  id: ID;
  workspaceId: ID;
  actor: { type: "user" | "service" | "ai"; id: ID; name: string };
  action: string;
  category: AuditCategory;
  resourceType: string;
  resourceId: ID;
  resourceName: string;
  createdAt: ISODate;
  metadata: Record<string, string | number | boolean>;
}

export interface AppNotification {
  id: ID;
  workspaceId: ID;
  kind: "run_failed" | "approval_requested" | "connection_error" | "info";
  title: string;
  body: string;
  href: string;
  createdAt: ISODate;
  read: boolean;
}

export interface UsageCounter {
  workspaceId: ID;
  periodStart: ISODate;
  metric: "executions" | "ai_analyses" | "webhook_deliveries";
  quantity: number;
}
