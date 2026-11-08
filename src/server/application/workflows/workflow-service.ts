import { ApiError, type Page, type SortDir } from "@/lib/api-error";
import type { Workflow, WorkflowDefinition, WorkflowRun, WorkflowStatus, WorkflowVersion } from "@/lib/domain/types";
import { checksum, validateWorkflow, type ValidationResult } from "@/lib/domain/validation";
import { INTEGRATIONS } from "@/lib/integrations/catalog";
import type { ScheduleService } from "../engine/schedule-service";
import { displayName, type ConnectionRepository, type ProfileRepository, type RunRepository, type ScheduleRepository, type VersionRepository, type WebhookRepository, type WorkflowRepository } from "../ports/repositories";
import type { RunLauncher } from "../runs/run-launcher";
import type { AuditLog } from "../shared/audit-log";
import type { RequestContext } from "../shared/context";
import { fieldError, found, onDuplicate } from "../shared/errors";
import { paginate } from "../shared/paging";
import { initialDraft, type NewWorkflowInput } from "./workflow-factory";

export interface WorkflowListItem {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  owner: { id: string; name: string };
  tags: string[];
  updatedAt: string;
  triggerType: "manual" | "webhook" | "schedule" | "none";
  currentVersion: number | null;
  lastRun: Pick<WorkflowRun, "id" | "status" | "startedAt"> | null;
  runCount7d: number;
}
export type WorkflowSortKey = "name" | "updatedAt" | "lastRun" | "status";
export interface WorkflowListParams { search?: string; status?: WorkflowStatus | "all"; ownerId?: string | "all"; sort?: WorkflowSortKey; dir?: SortDir; page?: number; pageSize?: number }

export interface WorkflowDetail {
  workflow: Workflow;
  owner: { id: string; name: string; email: string };
  versions: Array<WorkflowVersion & { publishedByName: string }>;
  currentVersion: WorkflowVersion | null;
  webhook: { id: string; name: string; status: string } | null;
  /** Present when the published version uses a schedule trigger. */
  schedule: { enabled: boolean; runOnce: boolean; description: string; nextRunAt: string | null; lastRunAt: string | null; lastRunId: string | null; lastError: string | null } | null;
  stats: { total: number; succeeded: number; failed: number; avgDurationMs: number | null };
  hasUnpublishedChanges: boolean;
}

const STATUS_ORDER: Record<WorkflowStatus, number> = { active: 0, paused: 1, draft: 2, archived: 3 };
const SORT_KEYS: Record<WorkflowSortKey, (w: WorkflowListItem) => string> = {
  name: (w) => w.name.toLowerCase(),
  status: (w) => String(STATUS_ORDER[w.status]),
  lastRun: (w) => w.lastRun?.startedAt ?? "",
  updatedAt: (w) => w.updatedAt,
};

const triggerTypeOf = (w: Workflow): WorkflowListItem["triggerType"] => {
  const trigger = w.draft.nodes.find((n) => n.kind === "trigger");
  return trigger?.kind === "trigger" ? trigger.config.triggerType : "none";
};

/** Authoring, publishing and running workflows. */
export class WorkflowService {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly versions: VersionRepository,
    private readonly runs: RunRepository,
    private readonly profiles: ProfileRepository,
    private readonly webhooks: WebhookRepository,
    private readonly schedules: ScheduleRepository,
    private readonly connections: ConnectionRepository,
    private readonly launcher: RunLauncher,
    private readonly scheduler: ScheduleService,
    private readonly audit: AuditLog,
  ) {}

  private async find(ctx: RequestContext, id: string): Promise<Workflow> {
    return found(await this.workflows.findInWorkspace(ctx.workspaceId, id), "Workflow not found in this workspace.");
  }

  async list(ctx: RequestContext, params: WorkflowListParams = {}): Promise<Page<WorkflowListItem>> {
    const workflows = await this.workflows.listByWorkspace(ctx.workspaceId);
    const ids = workflows.map((w) => w.id);
    const runs = ids.length ? await this.runs.recentForWorkflows(ids, 2000) : [];
    const vers = ids.length ? await this.versions.numbers(ids) : [];
    const owners = await this.profiles.names(workflows.map((w) => w.ownerId));
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    let items: WorkflowListItem[] = workflows.map((w) => {
      const r = runs.filter((x) => x.workflowId === w.id);
      return {
        id: w.id, name: w.name, description: w.description, status: w.status, tags: w.tags, updatedAt: w.updatedAt,
        owner: { id: w.ownerId, name: displayName(owners.get(w.ownerId)) ?? "Former member" },
        triggerType: triggerTypeOf(w),
        currentVersion: vers.find((v) => v.id === w.currentVersionId)?.version ?? null,
        lastRun: r[0] ? { id: r[0].id, status: r[0].status, startedAt: r[0].startedAt } : null,
        runCount7d: r.filter((x) => x.startedAt > weekAgo).length,
      };
    });
    const q = params.search?.trim().toLowerCase();
    if (q) items = items.filter((w) => [w.name, w.description, w.owner.name, ...w.tags].some((t) => t.toLowerCase().includes(q)));
    if (params.status && params.status !== "all") items = items.filter((w) => w.status === params.status);
    if (params.ownerId && params.ownerId !== "all") items = items.filter((w) => w.owner.id === params.ownerId);
    const key = SORT_KEYS[params.sort ?? "updatedAt"];
    const sign = (params.dir ?? "desc") === "asc" ? 1 : -1;
    items.sort((a, b) => sign * key(a).localeCompare(key(b)));
    return paginate(items, params.page, params.pageSize ?? 10);
  }

  async owners(ctx: RequestContext) {
    const map = await this.profiles.names(await this.workflows.ownerIds(ctx.workspaceId));
    return [...map.entries()].map(([id, v]) => ({ id, name: displayName(v)! })).sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(ctx: RequestContext, id: string): Promise<WorkflowDetail> {
    const workflow = await this.find(ctx, id);
    const all = await this.versions.listByWorkflow(id);
    const people = await this.profiles.names([workflow.ownerId, ...all.map((v) => v.publishedBy)]);
    const versions = all.map((v) => ({ ...v, publishedByName: displayName(people.get(v.publishedBy)) ?? "Unknown" }));
    const currentVersion = versions.find((v) => v.id === workflow.currentVersionId) ?? null;
    const runs = await this.runs.timingsForWorkflow(id);
    const done = runs.filter((r) => r.endedAt);
    const webhook = await this.webhooks.byWorkflow(id);
    const sch = await this.schedules.findByWorkflow(id);
    return {
      workflow,
      owner: { id: workflow.ownerId, name: displayName(people.get(workflow.ownerId)) ?? "Former member", email: people.get(workflow.ownerId)?.email ?? "" },
      versions,
      currentVersion,
      webhook,
      schedule: sch ? { enabled: sch.enabled, runOnce: sch.runOnce, description: sch.description, nextRunAt: sch.nextRunAt, lastRunAt: sch.lastRunAt, lastRunId: sch.lastRunId, lastError: sch.lastError } : null,
      stats: {
        total: runs.length,
        succeeded: runs.filter((r) => r.status === "succeeded").length,
        failed: runs.filter((r) => r.status === "failed").length,
        avgDurationMs: done.length ? done.reduce((a, r) => a + (new Date(r.endedAt!).getTime() - new Date(r.startedAt).getTime()), 0) / done.length : null,
      },
      hasUnpublishedChanges: !currentVersion || checksum(currentVersion.definition) !== checksum(workflow.draft),
    };
  }

  async create(ctx: RequestContext, input: NewWorkflowInput): Promise<Workflow> {
    const name = input.name.trim();
    if (name.length < 3) throw fieldError({ name: "Use at least 3 characters." });
    const wf = await onDuplicate(
      () => this.workflows.insert({ workspaceId: ctx.workspaceId, name, description: input.description.trim(), ownerId: ctx.user.id, tags: input.tags, draft: initialDraft(input, ctx.workspace.settings.timezone) }),
      () => fieldError({ name: "A workflow with this name already exists." }, "CONFLICT"),
    );
    await this.audit.record(ctx, { action: "workflow.created", category: "workflow", resourceType: "workflow", resourceId: wf.id, resourceName: wf.name, metadata: { template: input.templateId ?? "none" } });
    return wf;
  }

  async updateMeta(ctx: RequestContext, id: string, input: { name: string; description: string; tags: string[] }): Promise<Workflow> {
    await this.find(ctx, id);
    if (input.name.trim().length < 3) throw fieldError({ name: "Use at least 3 characters." });
    const wf = await this.workflows.update(ctx.workspaceId, id, { name: input.name.trim(), description: input.description.trim(), tags: input.tags, updatedAt: new Date().toISOString() });
    await this.audit.record(ctx, { action: "workflow.updated", category: "workflow", resourceType: "workflow", resourceId: id, resourceName: wf.name, metadata: {} });
    return wf;
  }

  /** Optimistic concurrency: the update only applies if the stored revision still matches. */
  async saveDraft(ctx: RequestContext, id: string, definition: WorkflowDefinition, baseRevision: number) {
    const wf = await this.find(ctx, id);
    if (wf.status === "archived") throw new ApiError("CONFLICT", "Archived workflows are read-only.");
    const now = new Date().toISOString();
    if (!(await this.workflows.saveDraftIfRevision(ctx.workspaceId, id, definition, baseRevision, now))) throw new ApiError("CONFLICT", "Someone else saved this draft since you opened it. Reload to get their changes.");
    await this.audit.record(ctx, { action: "workflow.draft_saved", category: "workflow", resourceType: "workflow", resourceId: id, resourceName: wf.name, metadata: { revision: baseRevision + 1, nodes: definition.nodes.length } });
    return { revision: baseRevision + 1, savedAt: now };
  }

  private async validationContext(ctx: RequestContext) {
    return { connections: await this.connections.listByWorkspace(ctx.workspaceId), integrations: INTEGRATIONS };
  }

  async validate(ctx: RequestContext, id: string, definition?: WorkflowDefinition): Promise<ValidationResult> {
    const wf = await this.find(ctx, id);
    return validateWorkflow(definition ?? wf.draft, await this.validationContext(ctx));
  }

  /** Publishes the saved draft as an immutable version. The server re-validates; client results aren't trusted. */
  async publish(ctx: RequestContext, id: string, changeNote: string, expectedRevision: number): Promise<WorkflowVersion> {
    const wf = await this.find(ctx, id);
    if (wf.draftRevision !== expectedRevision) throw new ApiError("CONFLICT", "The draft changed since you validated it. Save and validate again.");
    if (wf.status === "archived") throw new ApiError("CONFLICT", "Archived workflows can't be published.");
    const result = validateWorkflow(wf.draft, await this.validationContext(ctx));
    if (!result.valid) throw new ApiError("VALIDATION", `Fix ${result.errors.length} validation error${result.errors.length === 1 ? "" : "s"} before publishing.`);
    const sum = checksum(wf.draft);
    const existing = await this.versions.checksums(id);
    const current = existing.find((v) => v.id === wf.currentVersionId);
    if (current?.checksum === sum) throw new ApiError("CONFLICT", `The draft is identical to version ${current.version}. Make a change before publishing.`);
    const next = Math.max(0, ...existing.map((v) => v.version)) + 1;
    const version = await this.versions.insert({ workspaceId: ctx.workspaceId, workflowId: id, version: next, definition: wf.draft, checksum: sum, publishedBy: ctx.user.id, changeNote: changeNote.trim() || `Version ${next}` });
    await this.workflows.update(ctx.workspaceId, id, { currentVersionId: version.id, status: wf.status === "draft" ? "active" : wf.status, updatedAt: new Date().toISOString() });
    await this.audit.record(ctx, { action: "workflow.published", category: "workflow", resourceType: "workflow", resourceId: id, resourceName: wf.name, metadata: { version: next, checksum: sum } });
    await this.scheduler.syncQuietly(id);
    return version;
  }

  async setStatus(ctx: RequestContext, id: string, status: "active" | "paused" | "archived"): Promise<Workflow> {
    const wf = await this.find(ctx, id);
    if (status === "active" && !wf.currentVersionId) throw new ApiError("CONFLICT", "Publish a version before activating this workflow.");
    if (wf.status === "archived") throw new ApiError("CONFLICT", "Archived workflows can't be changed.");
    const updated = await this.workflows.update(ctx.workspaceId, id, { status, updatedAt: new Date().toISOString() });
    const action = status === "paused" ? "workflow.paused" : status === "archived" ? "workflow.archived" : "workflow.resumed";
    await this.audit.record(ctx, { action, category: "workflow", resourceType: "workflow", resourceId: id, resourceName: wf.name, metadata: { from: wf.status, to: status } });
    await this.scheduler.syncQuietly(id);
    return updated;
  }

  async runNow(ctx: RequestContext, id: string, input: Record<string, unknown>): Promise<WorkflowRun> {
    const wf = await this.find(ctx, id);
    const run = await this.launcher.start({ workspaceId: ctx.workspaceId, workflow: wf, input, trigger: { source: "manual", actorId: ctx.user.id, detail: `Run now by ${ctx.user.name}` } });
    await this.audit.record(ctx, { action: "run.triggered", category: "run", resourceType: "workflow_run", resourceId: run.id, resourceName: wf.name, metadata: { version: run.version, source: "manual" } });
    return run;
  }

  /** Example payload for the Run dialog: the last run's input, or the trigger's required fields. */
  async sampleInput(ctx: RequestContext, id: string): Promise<Record<string, unknown>> {
    const wf = await this.find(ctx, id);
    const last = await this.runs.lastInput(id);
    if (last && typeof last === "object" && Object.keys(last).length && !JSON.stringify(last).includes("•")) return last as Record<string, unknown>;
    const trigger = wf.draft.nodes.find((n) => n.kind === "trigger");
    const fields = trigger?.kind === "trigger" ? trigger.config.requiredFields : [];
    return Object.fromEntries(fields.map((f) => [f, f.toLowerCase().includes("email") ? "you@example.com" : `example ${f}`]));
  }
}
