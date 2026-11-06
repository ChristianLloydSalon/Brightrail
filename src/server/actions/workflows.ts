"use server";

import { ApiError, type Page, type SortDir } from "@/lib/api-error";
import type { Workflow, WorkflowDefinition, WorkflowRun, WorkflowStatus, WorkflowVersion } from "@/lib/domain/types";
import { checksum, validateWorkflow, type ValidationResult } from "@/lib/domain/validation";
import { defaultSchedule } from "@/lib/engine/schedule";
import { TEMPLATES } from "@/lib/templates";
import { act, getContext, must, type RequestContext } from "../context";
import { startRun } from "../engine/runs";
import { syncSchedule } from "../engine/schedules";
import { toRun, toVersion, toWorkflow } from "../rows";
import { validationContext } from "../validation";

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

async function names(ctx: RequestContext, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, { name: string; email: string }>();
  const { data } = await ctx.db.from("profiles").select("id, name, email").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id as string, { name: (p.name as string) || (p.email as string), email: p.email as string }]));
}

async function findWorkflow(ctx: RequestContext, id: string) {
  const row = must(await ctx.db.from("workflows").select("*").eq("id", id).eq("workspace_id", ctx.workspace.id).maybeSingle(), "Workflow not found in this workspace.");
  return row;
}

export async function list(params: WorkflowListParams = {}) {
  return act(async (): Promise<Page<WorkflowListItem>> => {
    const ctx = await getContext("workflows.view");
    const { data: wfs } = await ctx.db.from("workflows").select("*").eq("workspace_id", ctx.workspace.id);
    const workflows = (wfs ?? []).map(toWorkflow);
    const ids = workflows.map((w) => w.id);
    const { data: runs } = ids.length ? await ctx.db.from("workflow_runs").select("id, workflow_id, status, started_at").in("workflow_id", ids).order("started_at", { ascending: false }).limit(2000) : { data: [] };
    const { data: vers } = ids.length ? await ctx.db.from("workflow_versions").select("id, version").in("workflow_id", ids) : { data: [] };
    const owners = await names(ctx, workflows.map((w) => w.ownerId));
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    let items: WorkflowListItem[] = workflows.map((w) => {
      const r = (runs ?? []).filter((x) => x.workflow_id === w.id);
      const trigger = w.draft.nodes.find((n) => n.kind === "trigger");
      return {
        id: w.id, name: w.name, description: w.description, status: w.status, tags: w.tags, updatedAt: w.updatedAt,
        owner: { id: w.ownerId, name: owners.get(w.ownerId)?.name ?? "Former member" },
        triggerType: trigger?.kind === "trigger" ? trigger.config.triggerType : "none",
        currentVersion: (vers ?? []).find((v) => v.id === w.currentVersionId)?.version ?? null,
        lastRun: r[0] ? { id: r[0].id, status: r[0].status, startedAt: r[0].started_at } : null,
        runCount7d: r.filter((x) => x.started_at > weekAgo).length,
      };
    });
    const q = params.search?.trim().toLowerCase();
    if (q) items = items.filter((w) => [w.name, w.description, w.owner.name, ...w.tags].some((t) => t.toLowerCase().includes(q)));
    if (params.status && params.status !== "all") items = items.filter((w) => w.status === params.status);
    if (params.ownerId && params.ownerId !== "all") items = items.filter((w) => w.owner.id === params.ownerId);
    const order: Record<WorkflowStatus, number> = { active: 0, paused: 1, draft: 2, archived: 3 };
    const sort = params.sort ?? "updatedAt";
    const dir = params.dir ?? "desc";
    const key = (w: WorkflowListItem) => (sort === "name" ? w.name.toLowerCase() : sort === "status" ? String(order[w.status]) : sort === "lastRun" ? (w.lastRun?.startedAt ?? "") : w.updatedAt);
    items.sort((a, b) => (dir === "asc" ? 1 : -1) * key(a).localeCompare(key(b)));
    const pageSize = params.pageSize ?? 10;
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
    const page = Math.min(Math.max(1, params.page ?? 1), pageCount);
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, pageCount };
  });
}

export async function owners() {
  return act(async () => {
    const ctx = await getContext("workflows.view");
    const { data } = await ctx.db.from("workflows").select("owner_id").eq("workspace_id", ctx.workspace.id);
    const map = await names(ctx, (data ?? []).map((r) => r.owner_id as string));
    return [...map.entries()].map(([id, v]) => ({ id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function get(id: string) {
  return act(async (): Promise<WorkflowDetail> => {
    const ctx = await getContext("workflows.view");
    const workflow = toWorkflow(await findWorkflow(ctx, id));
    const { data: vrows } = await ctx.db.from("workflow_versions").select("*").eq("workflow_id", id).order("version", { ascending: false });
    const versionsRaw = (vrows ?? []).map(toVersion);
    const people = await names(ctx, [workflow.ownerId, ...versionsRaw.map((v) => v.publishedBy)]);
    const versions = versionsRaw.map((v) => ({ ...v, publishedByName: people.get(v.publishedBy)?.name ?? "Unknown" }));
    const currentVersion = versions.find((v) => v.id === workflow.currentVersionId) ?? null;
    const { data: runs } = await ctx.db.from("workflow_runs").select("status, started_at, ended_at").eq("workflow_id", id);
    const done = (runs ?? []).filter((r) => r.ended_at);
    const { data: wh } = await ctx.db.from("webhook_endpoints").select("id, name, status").eq("workflow_id", id).maybeSingle();
    const { data: sch } = await ctx.db.from("workflow_schedules").select("*").eq("workflow_id", id).maybeSingle();
    return {
      workflow,
      owner: { id: workflow.ownerId, name: people.get(workflow.ownerId)?.name ?? "Former member", email: people.get(workflow.ownerId)?.email ?? "" },
      versions,
      currentVersion,
      webhook: wh ?? null,
      schedule: sch ? { enabled: sch.enabled, runOnce: !!sch.run_once, description: sch.description, nextRunAt: sch.next_run_at, lastRunAt: sch.last_run_at, lastRunId: sch.last_run_id, lastError: sch.last_error } : null,
      stats: {
        total: runs?.length ?? 0,
        succeeded: (runs ?? []).filter((r) => r.status === "succeeded").length,
        failed: (runs ?? []).filter((r) => r.status === "failed").length,
        avgDurationMs: done.length ? done.reduce((a, r) => a + (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()), 0) / done.length : null,
      },
      hasUnpublishedChanges: !currentVersion || checksum(currentVersion.definition) !== checksum(workflow.draft),
    };
  });
}

export async function create(input: { name: string; description: string; triggerType: "manual" | "webhook" | "schedule"; tags: string[]; templateId?: string }) {
  return act(async (): Promise<Workflow> => {
    const ctx = await getContext("workflows.edit");
    const name = input.name.trim();
    if (name.length < 3) throw new ApiError("VALIDATION", "Check the highlighted fields.", { name: "Use at least 3 characters." });
    const template = TEMPLATES.find((t) => t.id === input.templateId);
    const draft: WorkflowDefinition = template
      ? template.build()
      : {
          nodes: [{
            id: "n_trigger", kind: "trigger", position: { x: 0, y: 0 },
            label: input.triggerType === "webhook" ? "Webhook received" : input.triggerType === "schedule" ? "On a schedule" : "Run manually",
            config: { triggerType: ["webhook", "schedule"].includes(input.triggerType) ? input.triggerType : "manual", eventName: "", requiredFields: [], ...(input.triggerType === "schedule" ? { schedule: defaultSchedule(ctx.workspace.settings.timezone || "UTC") } : {}) },
          }],
          edges: [],
        };
    const { data, error } = await ctx.db
      .from("workflows")
      .insert({ workspace_id: ctx.workspace.id, name, description: input.description.trim(), owner_id: ctx.user.id, tags: input.tags, draft })
      .select("*")
      .single();
    if (error?.code === "23505") throw new ApiError("CONFLICT", "Check the highlighted fields.", { name: "A workflow with this name already exists." });
    const wf = toWorkflow(must({ data, error }));
    await ctx.audit({ action: "workflow.created", category: "workflow", resourceType: "workflow", resourceId: wf.id, resourceName: wf.name, metadata: { template: input.templateId ?? "none" } });
    return wf;
  });
}

export async function updateMeta(id: string, input: { name: string; description: string; tags: string[] }) {
  return act(async () => {
    const ctx = await getContext("workflows.edit");
    await findWorkflow(ctx, id);
    if (input.name.trim().length < 3) throw new ApiError("VALIDATION", "Check the highlighted fields.", { name: "Use at least 3 characters." });
    const row = must(await ctx.db.from("workflows").update({ name: input.name.trim(), description: input.description.trim(), tags: input.tags, updated_at: ctx.now() }).eq("id", id).select("*").single());
    await ctx.audit({ action: "workflow.updated", category: "workflow", resourceType: "workflow", resourceId: id, resourceName: row.name, metadata: {} });
    return toWorkflow(row);
  });
}

/** Optimistic concurrency: the update only applies if the stored revision still matches. */
export async function saveDraft(id: string, definition: WorkflowDefinition, baseRevision: number) {
  return act(async () => {
    const ctx = await getContext("workflows.edit");
    const wf = await findWorkflow(ctx, id);
    if (wf.status === "archived") throw new ApiError("CONFLICT", "Archived workflows are read-only.");
    const now = ctx.now();
    const { data } = await ctx.db
      .from("workflows")
      .update({ draft: definition, draft_revision: baseRevision + 1, draft_updated_at: now, updated_at: now })
      .eq("id", id)
      .eq("draft_revision", baseRevision)
      .select("draft_revision");
    if (!data?.length) throw new ApiError("CONFLICT", "Someone else saved this draft since you opened it. Reload to get their changes.");
    await ctx.audit({ action: "workflow.draft_saved", category: "workflow", resourceType: "workflow", resourceId: id, resourceName: wf.name, metadata: { revision: baseRevision + 1, nodes: definition.nodes.length } });
    return { revision: baseRevision + 1, savedAt: now };
  });
}

export async function validate(id: string, definition?: WorkflowDefinition) {
  return act(async (): Promise<ValidationResult> => {
    const ctx = await getContext("workflows.view");
    const wf = toWorkflow(await findWorkflow(ctx, id));
    return validateWorkflow(definition ?? wf.draft, await validationContext(ctx));
  });
}

/** (Re)arms or disarms the schedule. Never fails the caller: the hourly reconcile job re-arms anything missed. */
async function armSchedule(workflowId: string) {
  try {
    await syncSchedule(workflowId);
  } catch (e) {
    console.error("[flowforge] schedule sync failed; the hourly reconcile will retry", (e as Error).message);
  }
}

/** Publishes the saved draft as an immutable version. The server re-validates; client results aren't trusted. */
export async function publish(id: string, changeNote: string, expectedRevision: number) {
  return act(async (): Promise<WorkflowVersion> => {
    const ctx = await getContext("workflows.publish");
    const wf = toWorkflow(await findWorkflow(ctx, id));
    if (wf.draftRevision !== expectedRevision) throw new ApiError("CONFLICT", "The draft changed since you validated it. Save and validate again.");
    if (wf.status === "archived") throw new ApiError("CONFLICT", "Archived workflows can't be published.");
    const result = validateWorkflow(wf.draft, await validationContext(ctx));
    if (!result.valid) throw new ApiError("VALIDATION", `Fix ${result.errors.length} validation error${result.errors.length === 1 ? "" : "s"} before publishing.`);
    const sum = checksum(wf.draft);
    const { data: versions } = await ctx.db.from("workflow_versions").select("id, version, checksum").eq("workflow_id", id);
    const current = (versions ?? []).find((v) => v.id === wf.currentVersionId);
    if (current?.checksum === sum) throw new ApiError("CONFLICT", `The draft is identical to version ${current.version}. Make a change before publishing.`);
    const next = Math.max(0, ...(versions ?? []).map((v) => v.version as number)) + 1;
    const row = must(await ctx.db.from("workflow_versions").insert({ workspace_id: ctx.workspace.id, workflow_id: id, version: next, definition: wf.draft, checksum: sum, published_by: ctx.user.id, change_note: changeNote.trim() || `Version ${next}` }).select("*").single());
    await ctx.db.from("workflows").update({ current_version_id: row.id, status: wf.status === "draft" ? "active" : wf.status, updated_at: ctx.now() }).eq("id", id);
    await ctx.audit({ action: "workflow.published", category: "workflow", resourceType: "workflow", resourceId: id, resourceName: wf.name, metadata: { version: next, checksum: sum } });
    await armSchedule(id);
    return toVersion(row);
  });
}

export async function setStatus(id: string, status: "active" | "paused" | "archived") {
  return act(async () => {
    const ctx = await getContext("workflows.edit");
    const wf = toWorkflow(await findWorkflow(ctx, id));
    if (status === "active" && !wf.currentVersionId) throw new ApiError("CONFLICT", "Publish a version before activating this workflow.");
    if (wf.status === "archived") throw new ApiError("CONFLICT", "Archived workflows can't be changed.");
    const row = must(await ctx.db.from("workflows").update({ status, updated_at: ctx.now() }).eq("id", id).select("*").single());
    await ctx.audit({ action: status === "paused" ? "workflow.paused" : status === "archived" ? "workflow.archived" : "workflow.resumed", category: "workflow", resourceType: "workflow", resourceId: id, resourceName: wf.name, metadata: { from: wf.status, to: status } });
    await armSchedule(id);
    return toWorkflow(row);
  });
}

export async function runNow(id: string, input: Record<string, unknown>) {
  return act(async (): Promise<WorkflowRun> => {
    const ctx = await getContext("runs.trigger");
    const wf = await findWorkflow(ctx, id);
    const run = await startRun({ workspaceId: ctx.workspace.id, workflow: wf, input, trigger: { source: "manual", actorId: ctx.user.id, detail: `Run now by ${ctx.user.name}` } });
    await ctx.audit({ action: "run.triggered", category: "run", resourceType: "workflow_run", resourceId: run.id, resourceName: wf.name, metadata: { version: run.version, source: "manual" } });
    return toRun(run);
  });
}

/** Example payload for the Run dialog: the last run's input, or the trigger's required fields. */
export async function sampleInput(id: string) {
  return act(async (): Promise<Record<string, unknown>> => {
    const ctx = await getContext("workflows.view");
    const wf = toWorkflow(await findWorkflow(ctx, id));
    const { data: last } = await ctx.db.from("workflow_runs").select("input").eq("workflow_id", id).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (last?.input && typeof last.input === "object" && Object.keys(last.input).length && !JSON.stringify(last.input).includes("•")) return last.input as Record<string, unknown>;
    const trigger = wf.draft.nodes.find((n) => n.kind === "trigger");
    const fields = trigger?.kind === "trigger" ? trigger.config.requiredFields : [];
    return Object.fromEntries(fields.map((f) => [f, f.toLowerCase().includes("email") ? "you@example.com" : `example ${f}`]));
  });
}
