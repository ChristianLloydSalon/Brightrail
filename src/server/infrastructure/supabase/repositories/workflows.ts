import "server-only";
import type { Workflow, WorkflowDefinition, WorkflowStatus, WorkflowVersion } from "@/lib/domain/types";
import type { RunnableWorkflow, VersionRepository, WorkflowRepository } from "@/server/application/ports/repositories";
import { must, mustUnique } from "../errors";
import { toVersion, toWorkflow } from "../mappers";
import { columns, SupabaseRepository } from "./base";

type RunnableRow = { id: string; name: string; status: string; current_version_id: string | null };
const toRunnable = (r: RunnableRow): RunnableWorkflow => ({ id: r.id, name: r.name, status: r.status, currentVersionId: r.current_version_id });

export class SupabaseWorkflowRepository extends SupabaseRepository implements WorkflowRepository {
  async findInWorkspace(workspaceId: string, id: string): Promise<Workflow | null> {
    const res = await this.db.from("workflows").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    if (res.error) must(res);
    return res.data ? toWorkflow(res.data) : null;
  }

  async findById(id: string): Promise<Workflow | null> {
    const { data } = await this.db.from("workflows").select("*").eq("id", id).maybeSingle();
    return data ? toWorkflow(data) : null;
  }

  async listByWorkspace(workspaceId: string): Promise<Workflow[]> {
    const { data } = await this.db.from("workflows").select("*").eq("workspace_id", workspaceId);
    return (data ?? []).map(toWorkflow);
  }

  async summaries(workspaceId: string) {
    const { data } = await this.db.from("workflows").select("id, status, current_version_id, created_at").eq("workspace_id", workspaceId);
    return (data ?? []).map((w) => ({ id: w.id as string, status: w.status as WorkflowStatus, currentVersionId: (w.current_version_id as string | null) ?? null, createdAt: w.created_at as string }));
  }

  async ownerIds(workspaceId: string): Promise<string[]> {
    const { data } = await this.db.from("workflows").select("owner_id").eq("workspace_id", workspaceId);
    return (data ?? []).map((r) => r.owner_id as string);
  }

  async insert(row: Parameters<WorkflowRepository["insert"]>[0]): Promise<Workflow> {
    return toWorkflow(mustUnique(await this.db.from("workflows").insert({ workspace_id: row.workspaceId, name: row.name, description: row.description, owner_id: row.ownerId, tags: row.tags, draft: row.draft }).select("*").single()));
  }

  async update(workspaceId: string, id: string, patch: Parameters<WorkflowRepository["update"]>[2]): Promise<Workflow> {
    const cols = columns(patch, { name: "name", description: "description", tags: "tags", status: "status", currentVersionId: "current_version_id", updatedAt: "updated_at" });
    return toWorkflow(must(await this.db.from("workflows").update(cols).eq("id", id).eq("workspace_id", workspaceId).select("*").single()));
  }

  async saveDraftIfRevision(workspaceId: string, id: string, draft: WorkflowDefinition, baseRevision: number, at: string): Promise<boolean> {
    const { data } = await this.db
      .from("workflows")
      .update({ draft, draft_revision: baseRevision + 1, draft_updated_at: at, updated_at: at })
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .eq("draft_revision", baseRevision)
      .select("draft_revision");
    return !!data?.length;
  }

  async runnable(id: string, workspaceId?: string): Promise<RunnableWorkflow | null> {
    let q = this.db.from("workflows").select("id, name, status, current_version_id").eq("id", id);
    if (workspaceId) q = q.eq("workspace_id", workspaceId);
    const { data } = await q.maybeSingle();
    return data ? toRunnable(data as RunnableRow) : null;
  }

  async statusOf(id: string, workspaceId?: string): Promise<WorkflowStatus | null> {
    let q = this.db.from("workflows").select("status").eq("id", id);
    if (workspaceId) q = q.eq("workspace_id", workspaceId);
    const { data } = await q.maybeSingle();
    return (data?.status as WorkflowStatus | undefined) ?? null;
  }

  async reassignOwner(workspaceId: string, fromUserId: string, toUserId: string): Promise<void> {
    await this.db.from("workflows").update({ owner_id: toUserId }).eq("workspace_id", workspaceId).eq("owner_id", fromUserId);
  }
}

export class SupabaseVersionRepository extends SupabaseRepository implements VersionRepository {
  async listByWorkflow(workflowId: string): Promise<WorkflowVersion[]> {
    const { data } = await this.db.from("workflow_versions").select("*").eq("workflow_id", workflowId).order("version", { ascending: false });
    return (data ?? []).map(toVersion);
  }

  async checksums(workflowId: string) {
    const { data } = await this.db.from("workflow_versions").select("id, version, checksum").eq("workflow_id", workflowId);
    return (data ?? []).map((v) => ({ id: v.id as string, version: v.version as number, checksum: v.checksum as string }));
  }

  async numbers(workflowIds: string[]) {
    const { data } = await this.db.from("workflow_versions").select("id, version").in("workflow_id", workflowIds);
    return (data ?? []).map((v) => ({ id: v.id as string, version: v.version as number }));
  }

  async findById(id: string): Promise<WorkflowVersion | null> {
    const { data } = await this.db.from("workflow_versions").select("*").eq("id", id).maybeSingle();
    return data ? toVersion(data) : null;
  }

  async definitionOf(id: string): Promise<WorkflowDefinition | null> {
    const { data } = await this.db.from("workflow_versions").select("definition").eq("id", id).maybeSingle();
    return (data?.definition as WorkflowDefinition | undefined) ?? null;
  }

  async insert(row: Parameters<VersionRepository["insert"]>[0]): Promise<WorkflowVersion> {
    return toVersion(must(await this.db.from("workflow_versions").insert({ workspace_id: row.workspaceId, workflow_id: row.workflowId, version: row.version, definition: row.definition, checksum: row.checksum, published_by: row.publishedBy, change_note: row.changeNote }).select("*").single()));
  }
}
