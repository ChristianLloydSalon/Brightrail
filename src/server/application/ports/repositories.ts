import type { NotificationPrefs } from "@/lib/domain/notification-prefs";
import type {
  AiAnalysis, ApiKey, ApiKeyScope, AppNotification, ApprovalRequest, ApprovalStatus, AuditCategory, AuditEvent, Connection, JsonValue, LogEntry, Member,
  MemberStatus, Role, RunStatus, StepRun, TriggerSource, WebhookDelivery, WebhookEndpoint, Workflow, WorkflowDefinition, WorkflowRun, WorkflowStatus,
  WorkflowVersion, Workspace, WorkspaceSettings,
} from "@/lib/domain/types";

/**
 * Persistence ports. The application layer depends only on these interfaces; the Supabase adapters in
 * infrastructure/supabase/repositories implement them. Every method speaks in domain types, not rows.
 */

export type Actor = AuditEvent["actor"];
/** A profile's stored name (may be empty) and email. */
export type PersonName = { name: string; email: string };
/** Name, falling back to the email address. */
export const displayName = (p: PersonName | undefined): string | undefined => (p ? p.name || p.email : undefined);

/* ---------------- workspaces & people ---------------- */

export interface WorkspaceRepository {
  findById(id: string): Promise<Workspace | null>;
  slugExists(slug: string): Promise<boolean>;
  create(row: { name: string; slug: string; createdBy: string; plan: Workspace["plan"]; quotas: Workspace["quotas"]; settings: WorkspaceSettings; grants: Workspace["grants"] }): Promise<Workspace>;
  /** Throws DuplicateKeyError when the slug is taken. */
  update(id: string, patch: Partial<Pick<Workspace, "name" | "slug" | "settings" | "grants" | "plan" | "quotas">>): Promise<Workspace>;
  delete(id: string): Promise<void>;
}

export interface Membership { member: Member; workspace: Workspace | null }

export interface MemberRepository {
  /** Active memberships with their workspace, for resolving the request context. */
  activeMembershipsOf(userId: string): Promise<Array<{ member: Member; workspace: Workspace }>>;
  membershipsOf(userId: string): Promise<Membership[]>;
  isActiveMember(userId: string, workspaceId: string): Promise<boolean>;
  /** Members holding a seat (everyone except suspended). */
  countSeated(workspaceId: string): Promise<number>;
  list(workspaceId: string, filter?: { role?: Role; status?: MemberStatus }): Promise<Member[]>;
  findInWorkspace(workspaceId: string, id: string): Promise<Member | null>;
  existingEmails(workspaceId: string, emails: string[]): Promise<string[]>;
  insert(row: { workspaceId: string; userId: string | null; email: string; name: string; role: Role; status: MemberStatus; invitedBy?: string; joinedAt?: string; lastActiveAt?: string }): Promise<Member>;
  update(workspaceId: string, id: string, patch: Partial<{ role: Role; status: MemberStatus; invitedAt: string }>): Promise<Member>;
  delete(workspaceId: string, id: string): Promise<void>;
  deleteMany(workspaceId: string, ids: string[]): Promise<void>;
  touch(id: string, at: string): void;
  findInvitation(userId: string, memberId: string): Promise<{ member: Member; workspaceName: string } | null>;
  acceptInvitation(memberId: string, name: string, at: string): Promise<void>;
  declineInvitation(userId: string, memberId: string): Promise<void>;
  renameUser(userId: string, name: string): Promise<void>;
  ownerships(userId: string): Promise<Array<{ workspaceId: string; workspaceName: string }>>;
  countOtherPeople(workspaceId: string, userId: string): Promise<number>;
  membershipIds(userId: string): Promise<Array<{ id: string; workspaceId: string }>>;
  firstActiveOwner(workspaceId: string): Promise<string | null>;
  activeRecipients(workspaceId: string): Promise<Array<{ userId: string; email: string; role: Role }>>;
}

export interface Profile { name: string; email: string; title: string | null; onboardingCompletedAt: string | null; notificationPrefs: unknown }

export interface ProfileRepository {
  /** Name and email for each id that has a profile. */
  names(ids: string[]): Promise<Map<string, PersonName>>;
  findById(id: string): Promise<Profile | null>;
  findByEmail(email: string): Promise<{ id: string; name: string } | null>;
  update(id: string, patch: Partial<{ name: string; title: string | null; notificationPrefs: NotificationPrefs; onboardingCompletedAt: string }>): Promise<void>;
  prefsFor(ids: string[]): Promise<Map<string, unknown>>;
}

/* ---------------- workflows ---------------- */

/** The fields needed to start a run. */
export interface RunnableWorkflow { id: string; name: string; status: WorkflowStatus | string; currentVersionId: string | null }

export interface WorkflowRepository {
  findInWorkspace(workspaceId: string, id: string): Promise<Workflow | null>;
  findById(id: string): Promise<Workflow | null>;
  listByWorkspace(workspaceId: string): Promise<Workflow[]>;
  /** Without drafts: cheap enough for the dashboard. */
  summaries(workspaceId: string): Promise<Array<Pick<Workflow, "id" | "status" | "currentVersionId" | "createdAt">>>;
  ownerIds(workspaceId: string): Promise<string[]>;
  /** Throws DuplicateKeyError when the name is taken. */
  insert(row: { workspaceId: string; name: string; description: string; ownerId: string; tags: string[]; draft: WorkflowDefinition }): Promise<Workflow>;
  update(workspaceId: string, id: string, patch: Partial<{ name: string; description: string; tags: string[]; status: WorkflowStatus; currentVersionId: string; updatedAt: string }>): Promise<Workflow>;
  /** Optimistic concurrency: applies only if the stored revision still equals `baseRevision`. */
  saveDraftIfRevision(workspaceId: string, id: string, draft: WorkflowDefinition, baseRevision: number, at: string): Promise<boolean>;
  runnable(id: string, workspaceId?: string): Promise<RunnableWorkflow | null>;
  statusOf(id: string, workspaceId?: string): Promise<WorkflowStatus | null>;
  reassignOwner(workspaceId: string, fromUserId: string, toUserId: string): Promise<void>;
}

export interface VersionRepository {
  listByWorkflow(workflowId: string): Promise<WorkflowVersion[]>;
  checksums(workflowId: string): Promise<Array<{ id: string; version: number; checksum: string }>>;
  numbers(workflowIds: string[]): Promise<Array<{ id: string; version: number }>>;
  findById(id: string): Promise<WorkflowVersion | null>;
  definitionOf(id: string): Promise<WorkflowDefinition | null>;
  insert(row: { workspaceId: string; workflowId: string; version: number; definition: WorkflowDefinition; checksum: string; publishedBy: string; changeNote: string }): Promise<WorkflowVersion>;
}

/* ---------------- runs ---------------- */

export interface RunQuery { status?: RunStatus; workflowId?: string; trigger?: TriggerSource; from?: string; to?: string; runId?: string; workflowNameLike?: string; sortColumn: "workflow_name" | "status" | "started_at"; ascending: boolean; offset: number; limit: number }
export type RunSummary = Pick<WorkflowRun, "id" | "workflowId" | "workflowName" | "version" | "status" | "trigger" | "startedAt" | "endedAt" | "steps" | "exception">;
export interface RunPatch { status?: RunStatus; endedAt?: string | null; steps?: StepRun[]; logs?: LogEntry[]; pass?: number; exception?: WorkflowRun["exception"] | null }

export interface RunRepository {
  create(row: { workspaceId: string; workflowId: string; workflowName: string; versionId: string; version: number; trigger: WorkflowRun["trigger"]; input: JsonValue; correlationId: string; steps: StepRun[]; logs: LogEntry[] }): Promise<WorkflowRun>;
  findById(id: string): Promise<WorkflowRun | null>;
  findInWorkspace(workspaceId: string, id: string): Promise<WorkflowRun | null>;
  search(workspaceId: string, q: RunQuery): Promise<{ rows: RunSummary[]; count: number }>;
  /** Most recent first. */
  recentForWorkflows(workflowIds: string[], limit: number): Promise<Array<Pick<WorkflowRun, "id" | "workflowId" | "status" | "startedAt">>>;
  timingsForWorkflow(workflowId: string): Promise<Array<Pick<WorkflowRun, "status" | "startedAt" | "endedAt">>>;
  /** Runs started since `since`, most recent first, for the dashboard. */
  recentInWorkspace(workspaceId: string, since: string, limit: number): Promise<RunSummary[]>;
  lastInput(workflowId: string): Promise<unknown>;
  countSince(workspaceId: string, since: string): Promise<number>;
  countAll(workspaceId: string): Promise<number>;
  update(id: string, patch: RunPatch, workspaceId?: string): Promise<void>;
  /** Updates only while the run is still in `status`. */
  updateIfStatus(id: string, status: RunStatus, patch: RunPatch): Promise<void>;
  passOf(id: string): Promise<{ pass: number; status: RunStatus } | null>;
  /** Compare-and-set on (pass, status): true if this caller claimed the next pass. */
  claimPass(workspaceId: string, id: string, expected: { pass: number; status: RunStatus }, patch: RunPatch): Promise<boolean>;
  /** The run's private data (trigger payload, step outputs, loop state). */
  contextOf(runId: string): Promise<Record<string, unknown> | null>;
  createContext(runId: string, data: Record<string, unknown>): Promise<void>;
  saveContext(runId: string, data: Record<string, unknown>): Promise<void>;
  purgeExpired(): Promise<number>;
}

export interface ScheduleRecord {
  workflowId: string; workspaceId: string; cron: string; timezone: string; description: string; runOnce: boolean; enabled: boolean; version: number;
  nextRunAt: string | null; lastRunAt: string | null; lastRunId: string | null; lastError: string | null;
}

export interface ScheduleRepository {
  findByWorkflow(workflowId: string): Promise<ScheduleRecord | null>;
  countEnabled(workspaceId: string): Promise<number>;
  disable(workflowId: string, version: number, lastError?: string): Promise<void>;
  upsert(row: Omit<ScheduleRecord, "lastRunAt" | "lastRunId">): Promise<void>;
  /** Atomically moves next_run_at forward from `slot`; true if this caller won the slot. */
  claimSlot(workflowId: string, version: number, slot: string, next: string | null, runOnce: boolean): Promise<boolean>;
  recordOutcome(workflowId: string, runId: string | null, error: string | null): Promise<void>;
  dueBefore(horizon: string): Promise<ScheduleRecord[]>;
  disableMissedOnce(workflowId: string, version: number, message: string): Promise<void>;
  moveSlot(workflowId: string, version: number, from: string, to: string, message: string): Promise<boolean>;
}

/* ---------------- approvals & AI ---------------- */

export interface ApprovalRepository {
  listForRun(runId: string): Promise<ApprovalRequest[]>;
  hasPending(runId: string): Promise<boolean>;
  countPending(workspaceId: string): Promise<number>;
  pendingRunIds(workspaceId: string): Promise<string[]>;
  overdueIds(now: string, workspaceId?: string, limit?: number): Promise<string[]>;
  list(workspaceId: string, status: ApprovalStatus | "all", limit: number): Promise<ApprovalRequest[]>;
  findInWorkspace(workspaceId: string, id: string): Promise<ApprovalRequest | null>;
  /** Throws DuplicateKeyError when the run already has a pending request. */
  insert(row: Pick<ApprovalRequest, "workspaceId" | "runId" | "stepId" | "workflowName" | "analysisId" | "actionType" | "toolCall" | "rationale" | "requestedBy" | "expiresAt">): Promise<ApprovalRequest>;
  /** Conditional: changes the request only while it is still pending (and, if given, not yet expired). Null if someone else won. */
  decideIfPending(workspaceId: string, id: string, patch: Pick<ApprovalRequest, "status" | "decidedBy" | "decidedByName" | "decidedAt"> & { decisionReason: string | null; outcome?: ApprovalRequest["outcome"] }, unexpiredAt?: string): Promise<ApprovalRequest | null>;
  expirePendingForRun(runId: string, reason: string): Promise<void>;
  settleOutcome(runId: string, outcome: "resolved" | "still_failing"): Promise<void>;
  expireIfDue(id: string, now: string): Promise<Pick<ApprovalRequest, "id" | "workspaceId" | "runId" | "workflowName" | "stepId"> | null>;
}

export type StoredAnalysis = AiAnalysis & { approvalRequestId?: string };

export interface AnalysisRepository {
  listForRun(runId: string): Promise<AiAnalysis[]>;
  findInWorkspace(workspaceId: string, id: string): Promise<StoredAnalysis | null>;
  insert(row: { workspaceId: string; runId: string; stepId: string; createdBy: string; data: unknown }): Promise<AiAnalysis>;
  linkApproval(workspaceId: string, analysis: StoredAnalysis, approvalId: string): Promise<void>;
}

/* ---------------- integrations ---------------- */

export interface ConnectionRepository {
  listByWorkspace(workspaceId: string): Promise<Connection[]>;
  findInWorkspace(workspaceId: string, id: string): Promise<Connection | null>;
  /** Only a connection of the expected integration in the run's workspace (credential binding). */
  findForExecution(id: string, workspaceId: string, integrationId: string): Promise<Connection | null>;
  countActive(workspaceId: string): Promise<number>;
  /** Throws DuplicateKeyError when the display name is taken. */
  insert(row: { workspaceId: string; integrationId: string; displayName: string; status: Connection["status"]; secretHint: string; config: Record<string, string>; createdBy: string; lastTestedAt: string; lastError: string | null }): Promise<Connection>;
  update(workspaceId: string, id: string, patch: Partial<{ displayName: string; config: Record<string, string>; status: Connection["status"]; secretHint: string; rotatedAt: string; lastTestedAt: string; lastError: string | null }>): Promise<Connection>;
}

export interface WebhookWithWorkflow { endpoint: WebhookEndpoint; workflowName: string | null; workflowStatus: string | null }

export interface WebhookRepository {
  byWorkflow(workflowId: string): Promise<{ id: string; name: string; status: string } | null>;
  countActive(workspaceId: string): Promise<number>;
  listWithWorkflow(workspaceId: string): Promise<WebhookWithWorkflow[]>;
  getWithWorkflow(workspaceId: string, id: string): Promise<WebhookWithWorkflow | null>;
  findInWorkspace(workspaceId: string, id: string): Promise<WebhookEndpoint | null>;
  findById(id: string): Promise<WebhookEndpoint | null>;
  /** Throws DuplicateKeyError when the workflow already has an endpoint. */
  insert(row: Pick<WebhookEndpoint, "workspaceId" | "workflowId" | "name" | "secretHint" | "replayWindowSec" | "maxBodyKb" | "rateLimitPerMin" | "verification">): Promise<WebhookEndpoint>;
  update(workspaceId: string, id: string, patch: Partial<Pick<WebhookEndpoint, "name" | "status" | "replayWindowSec" | "maxBodyKb" | "rateLimitPerMin" | "verification" | "headerKeyOnly">>): Promise<WebhookEndpoint>;
  setSecretHint(workspaceId: string, id: string, hint: string, rotatedAt: string): Promise<void>;
}

export type DeliveryStatus = WebhookDelivery["status"];

export interface DeliveryRepository {
  recentInWorkspace(workspaceId: string, since: string, limit: number): Promise<WebhookDelivery[]>;
  forEndpoint(endpointId: string, limit: number): Promise<WebhookDelivery[]>;
  record(row: { workspaceId: string; endpointId: string; eventId: string; status: DeliveryStatus; httpStatus: number; bytes: number; runId?: string }): Promise<void>;
  /** Inserts the idempotency record; null if one already exists (a concurrent duplicate). */
  insertAccepted(row: { workspaceId: string; endpointId: string; eventId: string; bytes: number; signatureKey: string | null }): Promise<string | null>;
  acceptedRunByEvent(endpointId: string, eventId: string): Promise<{ runId: string | null } | null>;
  acceptedRunBySignature(endpointId: string, signatureKey: string): Promise<{ runId: string | null } | null>;
  attachRun(deliveryId: string, runId: string): Promise<void>;
  delete(deliveryId: string): Promise<void>;
}

/* ---------------- admin ---------------- */

export interface ApiKeyRepository {
  list(workspaceId: string): Promise<ApiKey[]>;
  insert(row: { workspaceId: string; name: string; prefix: string; hint: string; keyHash: string; scopes: ApiKeyScope[]; createdBy: string; expiresAt: string | null }): Promise<ApiKey>;
  revoke(workspaceId: string, id: string): Promise<ApiKey>;
  revokeCreatedBy(workspaceId: string, userId: string): Promise<void>;
  findByHash(hash: string): Promise<ApiKey | null>;
  touch(id: string, at: string): Promise<void>;
}

export interface AuditQuery { category?: AuditCategory; actorId?: string; from?: string; to?: string; search?: string; ascending: boolean; offset: number; limit: number }

export interface AuditRepository {
  insert(workspaceId: string, actor: Actor, e: Pick<AuditEvent, "action" | "category" | "resourceType" | "resourceId" | "resourceName" | "metadata">): Promise<void>;
  search(workspaceId: string, q: AuditQuery): Promise<{ rows: AuditEvent[]; count: number }>;
  recentActors(workspaceId: string, limit: number): Promise<Actor[]>;
  recent(workspaceId: string, limit: number): Promise<AuditEvent[]>;
}

export interface NotificationRepository {
  insert(row: Pick<AppNotification, "workspaceId" | "kind" | "title" | "body" | "href">): Promise<string | null>;
  findById(id: string): Promise<AppNotification | null>;
  recent(workspaceId: string, limit: number): Promise<AppNotification[]>;
  readIds(userId: string, ids: string[]): Promise<Set<string>>;
  unreadCount(workspaceId: string, userId: string, since: string): Promise<number>;
  markAllRead(workspaceId: string, userId: string): Promise<void>;
  idsInWorkspace(workspaceId: string, ids: string[]): Promise<string[]>;
  markRead(workspaceId: string, userId: string, ids: string[]): Promise<void>;
}
