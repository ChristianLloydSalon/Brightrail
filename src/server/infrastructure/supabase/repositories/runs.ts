import "server-only";
import { ApiError } from "@/lib/api-error";
import type { RunStatus, StepRun, WorkflowRun } from "@/lib/domain/types";
import type { RunPatch, RunQuery, RunRepository, RunSummary, ScheduleRecord, ScheduleRepository } from "@/server/application/ports/repositories";
import { toRun, toSchedule } from "../mappers";
import { columns, SupabaseRepository } from "./base";

const SUMMARY_COLUMNS = "id, workflow_id, workflow_name, version, status, trigger, started_at, ended_at, steps, exception";
type Row = Record<string, unknown>;

const toSummary = (r: Row): RunSummary => ({
  id: r.id as string, workflowId: r.workflow_id as string, workflowName: r.workflow_name as string, version: r.version as number, status: r.status as RunStatus,
  trigger: r.trigger as WorkflowRun["trigger"], startedAt: r.started_at as string, endedAt: (r.ended_at as string | null) ?? undefined, steps: (r.steps as StepRun[] | null) ?? [],
  exception: (r.exception as WorkflowRun["exception"] | null) ?? undefined,
});

const runColumns = (p: RunPatch) => columns(p, { status: "status", endedAt: "ended_at", steps: "steps", logs: "logs", pass: "pass", exception: "exception" });

export class SupabaseRunRepository extends SupabaseRepository implements RunRepository {
  async create(row: Parameters<RunRepository["create"]>[0]): Promise<WorkflowRun> {
    const { data, error } = await this.db
      .from("workflow_runs")
      .insert({
        workspace_id: row.workspaceId, workflow_id: row.workflowId, workflow_name: row.workflowName, workflow_version_id: row.versionId, version: row.version,
        status: "queued", trigger: row.trigger, input: row.input, correlation_id: row.correlationId, steps: row.steps, logs: row.logs,
      })
      .select("*")
      .single();
    if (error || !data) throw new ApiError("INTERNAL", "Couldn't create the run.");
    return toRun(data);
  }

  async findById(id: string): Promise<WorkflowRun | null> {
    const { data } = await this.db.from("workflow_runs").select("*").eq("id", id).maybeSingle();
    return data ? toRun(data) : null;
  }

  async findInWorkspace(workspaceId: string, id: string): Promise<WorkflowRun | null> {
    const { data } = await this.db.from("workflow_runs").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    return data ? toRun(data) : null;
  }

  async search(workspaceId: string, p: RunQuery) {
    let q = this.db.from("workflow_runs").select(SUMMARY_COLUMNS, { count: "exact" }).eq("workspace_id", workspaceId);
    if (p.status) q = q.eq("status", p.status);
    if (p.workflowId) q = q.eq("workflow_id", p.workflowId);
    if (p.trigger) q = q.eq("trigger->>source", p.trigger);
    if (p.from) q = q.gte("started_at", p.from);
    if (p.to) q = q.lte("started_at", p.to);
    if (p.runId) q = q.eq("id", p.runId);
    else if (p.workflowNameLike) q = q.ilike("workflow_name", `%${p.workflowNameLike}%`);
    const { data, count, error } = await q.order(p.sortColumn, { ascending: p.ascending }).range(p.offset, p.offset + p.limit - 1);
    if (error) throw new ApiError("INTERNAL", "Couldn't load runs.");
    const rows = (data ?? []).map((r) => toSummary(r as Row));
    return { rows, count: count ?? rows.length };
  }

  async recentForWorkflows(workflowIds: string[], limit: number) {
    const { data } = await this.db.from("workflow_runs").select("id, workflow_id, status, started_at").in("workflow_id", workflowIds).order("started_at", { ascending: false }).limit(limit);
    return (data ?? []).map((r) => ({ id: r.id as string, workflowId: r.workflow_id as string, status: r.status as RunStatus, startedAt: r.started_at as string }));
  }

  async timingsForWorkflow(workflowId: string) {
    const { data } = await this.db.from("workflow_runs").select("status, started_at, ended_at").eq("workflow_id", workflowId);
    return (data ?? []).map((r) => ({ status: r.status as RunStatus, startedAt: r.started_at as string, endedAt: (r.ended_at as string | null) ?? undefined }));
  }

  async recentInWorkspace(workspaceId: string, since: string, limit: number): Promise<RunSummary[]> {
    const { data } = await this.db.from("workflow_runs").select(SUMMARY_COLUMNS).eq("workspace_id", workspaceId).gte("started_at", since).order("started_at", { ascending: false }).limit(limit);
    return (data ?? []).map((r) => toSummary(r as Row));
  }

  async lastInput(workflowId: string): Promise<unknown> {
    const { data } = await this.db.from("workflow_runs").select("input").eq("workflow_id", workflowId).order("started_at", { ascending: false }).limit(1).maybeSingle();
    return data?.input ?? null;
  }

  async countSince(workspaceId: string, since: string): Promise<number> {
    const { count } = await this.db.from("workflow_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).gte("started_at", since);
    return count ?? 0;
  }

  async countAll(workspaceId: string): Promise<number> {
    const { count } = await this.db.from("workflow_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
    return count ?? 0;
  }

  async update(id: string, patch: RunPatch, workspaceId?: string): Promise<void> {
    let q = this.db.from("workflow_runs").update(runColumns(patch)).eq("id", id);
    if (workspaceId) q = q.eq("workspace_id", workspaceId);
    await q;
  }

  async updateIfStatus(id: string, status: RunStatus, patch: RunPatch): Promise<void> {
    await this.db.from("workflow_runs").update(runColumns(patch)).eq("id", id).eq("status", status);
  }

  async passOf(id: string) {
    const { data } = await this.db.from("workflow_runs").select("pass, status").eq("id", id).maybeSingle();
    return data ? { pass: (data.pass as number | null) ?? 0, status: data.status as RunStatus } : null;
  }

  async claimPass(workspaceId: string, id: string, expected: { pass: number; status: RunStatus }, patch: RunPatch): Promise<boolean> {
    const { data } = await this.db.from("workflow_runs").update(runColumns(patch)).eq("id", id).eq("workspace_id", workspaceId).eq("pass", expected.pass).eq("status", expected.status).select("id");
    return !!data?.length;
  }

  async contextOf(runId: string): Promise<Record<string, unknown> | null> {
    const { data } = await this.db.from("run_contexts").select("data").eq("run_id", runId).maybeSingle();
    return (data?.data as Record<string, unknown> | undefined) ?? null;
  }

  async createContext(runId: string, data: Record<string, unknown>): Promise<void> {
    await this.db.from("run_contexts").insert({ run_id: runId, data });
  }

  async saveContext(runId: string, data: Record<string, unknown>): Promise<void> {
    await this.db.from("run_contexts").update({ data }).eq("run_id", runId);
  }

  async purgeExpired(): Promise<number> {
    const { data, error } = await this.db.rpc("purge_expired_runs");
    if (error) throw new Error(`purge_expired_runs failed: ${error.message}`);
    return Number(data ?? 0);
  }
}

export class SupabaseScheduleRepository extends SupabaseRepository implements ScheduleRepository {
  async findByWorkflow(workflowId: string): Promise<ScheduleRecord | null> {
    const { data } = await this.db.from("workflow_schedules").select("*").eq("workflow_id", workflowId).maybeSingle();
    return data ? toSchedule(data) : null;
  }

  async countEnabled(workspaceId: string): Promise<number> {
    const { count } = await this.db.from("workflow_schedules").select("workflow_id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("enabled", true);
    return count ?? 0;
  }

  async disable(workflowId: string, version: number, lastError?: string): Promise<void> {
    await this.db.from("workflow_schedules").update({ enabled: false, version, next_run_at: null, ...(lastError !== undefined ? { last_error: lastError } : {}), updated_at: new Date().toISOString() }).eq("workflow_id", workflowId);
  }

  async upsert(row: Omit<ScheduleRecord, "lastRunAt" | "lastRunId">): Promise<void> {
    const { error } = await this.db.from("workflow_schedules").upsert({
      workflow_id: row.workflowId, workspace_id: row.workspaceId, cron: row.cron, timezone: row.timezone, description: row.description, run_once: row.runOnce, enabled: row.enabled,
      version: row.version, next_run_at: row.nextRunAt, last_error: row.lastError, updated_at: new Date().toISOString(),
    }, { onConflict: "workflow_id" });
    if (error) throw new Error(`Couldn't save the schedule: ${error.message}`);
  }

  async claimSlot(workflowId: string, version: number, slot: string, next: string | null, runOnce: boolean): Promise<boolean> {
    const now = new Date().toISOString();
    const { data } = await this.db
      .from("workflow_schedules")
      .update({ next_run_at: next, ...(runOnce ? { enabled: false } : {}), last_run_at: now, updated_at: now })
      .eq("workflow_id", workflowId).eq("version", version).eq("next_run_at", slot)
      .select("workflow_id");
    return !!data?.length;
  }

  async recordOutcome(workflowId: string, runId: string | null, error: string | null): Promise<void> {
    await this.db.from("workflow_schedules").update({ last_run_id: runId, last_error: error }).eq("workflow_id", workflowId);
  }

  async dueBefore(horizon: string): Promise<ScheduleRecord[]> {
    const { data } = await this.db.from("workflow_schedules").select("*").eq("enabled", true).lte("next_run_at", horizon);
    return (data ?? []).map(toSchedule);
  }

  async disableMissedOnce(workflowId: string, version: number, message: string): Promise<void> {
    await this.db.from("workflow_schedules").update({ enabled: false, next_run_at: null, last_error: message }).eq("workflow_id", workflowId).eq("version", version);
  }

  async moveSlot(workflowId: string, version: number, from: string, to: string, message: string): Promise<boolean> {
    const { data } = await this.db.from("workflow_schedules").update({ next_run_at: to, last_error: message }).eq("workflow_id", workflowId).eq("version", version).eq("next_run_at", from).select("workflow_id");
    return !!data?.length;
  }
}
