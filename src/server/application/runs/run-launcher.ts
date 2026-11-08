import { ApiError } from "@/lib/api-error";
import { redact } from "@/lib/domain/redaction";
import { monthStartUtc, plannedSteps, runLog } from "@/lib/domain/run-rules";
import type { JsonValue, TriggerSource, WorkflowRun } from "@/lib/domain/types";
import { runContextFrom } from "@/lib/engine/logic";
import { uid } from "@/lib/utils";
import type { RunnableWorkflow, RunRepository, VersionRepository, WorkspaceRepository } from "../ports/repositories";
import type { EventBus } from "../ports/services";

export interface StartRunCommand {
  workspaceId: string;
  workflow: RunnableWorkflow;
  input: Record<string, unknown>;
  trigger: { source: TriggerSource; actorId?: string; detail: string };
}

/**
 * Starts runs, whatever triggered them (Run now, API key, webhook, schedule): checks the workflow can
 * run and the monthly quota, creates the run record pinned to the published version plus its private
 * context, then hands the run to the durable worker.
 */
export class RunLauncher {
  constructor(
    private readonly runs: RunRepository,
    private readonly versions: VersionRepository,
    private readonly workspaces: WorkspaceRepository,
    private readonly bus: EventBus,
  ) {}

  /** Monthly execution quota (workspaces.quotas.executionsPerMonth), counted per calendar month in UTC. */
  async assertQuota(workspaceId: string): Promise<void> {
    const ws = await this.workspaces.findById(workspaceId);
    const limit = Number(ws?.quotas?.executionsPerMonth ?? 1000);
    const count = await this.runs.countSince(workspaceId, monthStartUtc().toISOString());
    if (count >= limit) throw new ApiError("RATE_LIMITED", `This workspace has used all ${limit} runs for this month. The limit resets on the 1st of the month (UTC).`);
  }

  async start(cmd: StartRunCommand): Promise<WorkflowRun> {
    const { workflow } = cmd;
    if (workflow.status !== "active") throw new ApiError("CONFLICT", workflow.status === "paused" ? "This workflow is paused. Resume it to accept runs." : "Only active (published) workflows can run.");
    if (!workflow.currentVersionId) throw new ApiError("CONFLICT", "Publish a version before running this workflow.");
    await this.assertQuota(cmd.workspaceId);
    const ver = await this.versions.findById(workflow.currentVersionId);
    if (!ver) throw new ApiError("CONFLICT", "The published version couldn't be found.");
    const ws = await this.workspaces.findById(cmd.workspaceId);
    // Workspace setting "Store minimal metadata only": no input/output bodies in run history.
    const minimal = ws?.settings.payloadStorage === "minimal";
    const correlationId = uid("corr", 10);
    const steps = plannedSteps(ver.definition);
    const created = await this.runs.create({
      workspaceId: cmd.workspaceId, workflowId: workflow.id, workflowName: workflow.name, versionId: ver.id, version: ver.version,
      trigger: cmd.trigger, input: minimal ? {} : redact(cmd.input as JsonValue), correlationId, steps,
      logs: [runLog("info", `Run accepted from ${cmd.trigger.source} trigger; pinned to version ${ver.version}.`, undefined, { correlationId })],
    });
    const run: WorkflowRun = { ...created, steps: steps.map((s) => ({ ...s, runId: created.id })) };
    await this.runs.update(run.id, { steps: run.steps });
    await this.runs.createContext(run.id, runContextFrom(cmd.input));
    try {
      await this.bus.requestRun({ runId: run.id, pass: 0 });
    } catch (e) {
      await this.runs.update(run.id, { status: "failed", endedAt: new Date().toISOString(), logs: [...run.logs, runLog("error", "The workflow worker couldn't be reached. Check the Inngest configuration (see SETUP.md).")] });
      console.error("[brightrail] inngest.send failed", e);
      throw new ApiError("NOT_CONFIGURED", "The run was created but the workflow worker couldn't be reached. Check INNGEST settings in .env.");
    }
    return run;
  }
}
