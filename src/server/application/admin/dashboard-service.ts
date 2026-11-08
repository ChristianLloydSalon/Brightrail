import { monthStartUtc } from "@/lib/domain/run-rules";
import type { AuditEvent, Role, RunStatus } from "@/lib/domain/types";
import type { ApprovalRepository, AuditRepository, ConnectionRepository, MemberRepository, RunRepository, RunSummary, WorkflowRepository } from "../ports/repositories";
import type { RequestContext } from "../shared/context";

export interface DashboardData {
  totals: { workflows: number; active: number; succeeded7d: number; failed7d: number; successRate7d: number | null; prevSucceeded: number; prevFailed: number };
  daily: Array<{ date: string; succeeded: number; failed: number; other: number }>;
  recentRuns: Array<{ id: string; workflowName: string; status: RunStatus; startedAt: string; endedAt?: string; trigger: string }>;
  failures: Array<{ runId: string; workflowName: string; step: string; errorCode: string; at: string; hasApproval: boolean }>;
  pendingApprovals: number;
  activity: AuditEvent[];
  usage: { executions: number; quota: number; members: number; memberQuota: number; connections: number; connectionQuota: number; connectionErrors: number };
  workspace: { name: string; plan: string; timezone: string; role: Role };
  gettingStarted: { createdWorkflow: boolean; connectedIntegration: boolean; published: boolean; ranWorkflow: boolean; invitedTeammate: boolean; firstWorkflowId: string | null };
}

const DAY = 86400_000;

/** Read model for the home dashboard: two weeks of runs, open exceptions, usage and onboarding progress. */
export class DashboardService {
  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly runs: RunRepository,
    private readonly connections: ConnectionRepository,
    private readonly members: MemberRepository,
    private readonly approvals: ApprovalRepository,
    private readonly audit: AuditRepository,
  ) {}

  async get(ctx: RequestContext): Promise<DashboardData> {
    const ws = ctx.workspaceId;
    const now = Date.now();
    const [wfs, R, conns, members, pending, activity, approvalRuns, monthCount, everRuns] = await Promise.all([
      this.workflows.summaries(ws),
      this.runs.recentInWorkspace(ws, new Date(now - 14 * DAY).toISOString(), 2000),
      this.connections.listByWorkspace(ws),
      this.members.list(ws),
      this.approvals.countPending(ws),
      this.audit.recent(ws, 8),
      this.approvals.pendingRunIds(ws),
      this.runs.countSince(ws, monthStartUtc().toISOString()), // same window as the quota check
      this.runs.countAll(ws),
    ]);
    const age = (r: RunSummary) => now - new Date(r.startedAt).getTime();
    const thisWeek = (st: RunStatus) => R.filter((r) => age(r) < 7 * DAY && r.status === st).length;
    const lastWeek = (st: RunStatus) => R.filter((r) => age(r) >= 7 * DAY && r.status === st).length;
    const s7 = thisWeek("succeeded");
    const f7 = thisWeek("failed");
    const activeConns = conns.filter((c) => c.status !== "revoked");
    const firstWf = [...wfs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    return {
      totals: { workflows: wfs.filter((w) => w.status !== "archived").length, active: wfs.filter((w) => w.status === "active").length, succeeded7d: s7, failed7d: f7, successRate7d: s7 + f7 ? s7 / (s7 + f7) : null, prevSucceeded: lastWeek("succeeded"), prevFailed: lastWeek("failed") },
      daily: Array.from({ length: 14 }, (_, i) => {
        const key = new Date(now - (13 - i) * DAY).toISOString().slice(0, 10);
        const day = R.filter((r) => r.startedAt.slice(0, 10) === key);
        return { date: key, succeeded: day.filter((r) => r.status === "succeeded").length, failed: day.filter((r) => r.status === "failed").length, other: day.filter((r) => r.status !== "succeeded" && r.status !== "failed").length };
      }),
      recentRuns: R.slice(0, 8).map((r) => ({ id: r.id, workflowName: r.workflowName, status: r.status, startedAt: r.startedAt, endedAt: r.endedAt, trigger: r.trigger.source })),
      failures: R.filter((r) => r.exception?.status === "open" && (r.status === "failed" || r.status === "waiting_approval")).slice(0, 5).map((r) => {
        const s = r.steps.find((x) => x.status === "failed");
        return { runId: r.id, workflowName: r.workflowName, step: s?.nodeLabel ?? "—", errorCode: s?.errorCode ?? "UNKNOWN", at: r.endedAt ?? r.startedAt, hasApproval: approvalRuns.includes(r.id) };
      }),
      pendingApprovals: pending,
      // Recent activity comes from the audit log, so it is shown only to roles allowed to see the audit log.
      activity: ctx.can("audit.view") ? activity : [],
      usage: { executions: monthCount, quota: ctx.workspace.quotas.executionsPerMonth, members: members.filter((m) => m.status !== "suspended").length, memberQuota: ctx.workspace.quotas.members, connections: activeConns.length, connectionQuota: ctx.workspace.quotas.connections, connectionErrors: activeConns.filter((c) => c.status === "error").length },
      workspace: { name: ctx.workspace.name, plan: ctx.workspace.plan, timezone: ctx.workspace.settings.timezone, role: ctx.member.role },
      gettingStarted: {
        createdWorkflow: wfs.length > 0,
        connectedIntegration: activeConns.length > 0,
        published: wfs.some((w) => w.currentVersionId),
        ranWorkflow: everRuns > 0,
        invitedTeammate: members.length > 1,
        firstWorkflowId: firstWf?.id ?? null,
      },
    };
  }
}
