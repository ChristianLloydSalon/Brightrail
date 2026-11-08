"use server";

import type { WorkflowDefinition } from "@/lib/domain/types";
import type { WorkflowListParams } from "../application/workflows/workflow-service";
import type { NewWorkflowInput } from "../application/workflows/workflow-factory";
import { inWorkspace } from "../presentation/action";

export type { WorkflowDetail, WorkflowListItem, WorkflowListParams, WorkflowSortKey } from "../application/workflows/workflow-service";

/** Thin controllers: authorization in `inWorkspace`, behaviour in WorkflowService. */

export async function list(params: WorkflowListParams = {}) {
  return inWorkspace("workflows.view", (app, ctx) => app.workflows.list(ctx, params));
}

export async function owners() {
  return inWorkspace("workflows.view", (app, ctx) => app.workflows.owners(ctx));
}

export async function get(id: string) {
  return inWorkspace("workflows.view", (app, ctx) => app.workflows.get(ctx, id));
}

export async function create(input: NewWorkflowInput) {
  return inWorkspace("workflows.edit", (app, ctx) => app.workflows.create(ctx, input));
}

export async function updateMeta(id: string, input: { name: string; description: string; tags: string[] }) {
  return inWorkspace("workflows.edit", (app, ctx) => app.workflows.updateMeta(ctx, id, input));
}

export async function saveDraft(id: string, definition: WorkflowDefinition, baseRevision: number) {
  return inWorkspace("workflows.edit", (app, ctx) => app.workflows.saveDraft(ctx, id, definition, baseRevision));
}

export async function validate(id: string, definition?: WorkflowDefinition) {
  return inWorkspace("workflows.view", (app, ctx) => app.workflows.validate(ctx, id, definition));
}

export async function publish(id: string, changeNote: string, expectedRevision: number) {
  return inWorkspace("workflows.publish", (app, ctx) => app.workflows.publish(ctx, id, changeNote, expectedRevision));
}

export async function setStatus(id: string, status: "active" | "paused" | "archived") {
  return inWorkspace("workflows.edit", (app, ctx) => app.workflows.setStatus(ctx, id, status));
}

export async function runNow(id: string, input: Record<string, unknown>) {
  return inWorkspace("runs.trigger", (app, ctx) => app.workflows.runNow(ctx, id, input));
}

export async function sampleInput(id: string) {
  return inWorkspace("workflows.view", (app, ctx) => app.workflows.sampleInput(ctx, id));
}
