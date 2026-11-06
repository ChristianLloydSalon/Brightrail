"use client";

import { useQuery } from "@tanstack/react-query";
import { planName } from "@/lib/domain/plans";
import { useLiveInterval } from "@/lib/realtime";
import { AlertTriangle, ArrowRight, Blocks, CheckCircle2, ClipboardCheck, Play, Plus, UserPlus, Workflow as WorkflowIcon, XCircle, Zap } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { MetricCard, Meter } from "@/components/shared/metric-card";
import { RelativeTime } from "@/components/shared/time";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, Mono, Panel, PanelHeader } from "@/components/ui/card";
import { Alert, EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { useCurrent, useWorkspaceId } from "@/hooks/use-current";
import { ROLE_LABELS } from "@/lib/domain/permissions";
import { RUN_STATUS_META } from "@/lib/domain/status";
import { formatDuration } from "@/lib/format";
import { dashboardApi } from "@/lib/services";
import { RunWorkflowDialog } from "@/features/workflows/run-workflow-dialog";
import { CreateWorkflowDialog } from "@/features/workflows/create-workflow-dialog";
import { describeAudit } from "@/features/admin/audit-describe";
import { GettingStarted } from "./getting-started";



function RunsChart({ daily }: { daily: Array<{ date: string; succeeded: number; failed: number; other: number }> }) {
  const max = Math.max(1, ...daily.map((d) => d.succeeded + d.failed + d.other));
  const total = daily.reduce((a, d) => a + d.succeeded + d.failed + d.other, 0);
  const failed = daily.reduce((a, d) => a + d.failed, 0);
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-sm text-fg-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-xs bg-success" />Succeeded</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-xs bg-danger" />Failed</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-xs bg-border-strong" />Other</span>
      </div>
      <div className="flex h-40 items-end gap-1 sm:gap-1.5" aria-hidden>
        {daily.map((d) => {
          const sum = d.succeeded + d.failed + d.other;
          return (
            <div key={d.date} className="group flex h-full flex-1 flex-col justify-end" title={`${fmt(d.date)}: ${d.succeeded} succeeded, ${d.failed} failed, ${d.other} other`}>
              <div className="flex flex-col-reverse overflow-hidden rounded-t-xs" style={{ height: `${(sum / max) * 100}%`, minHeight: sum ? 3 : 0 }}>
                <div className="bg-success" style={{ flexGrow: d.succeeded }} />
                <div className="bg-danger" style={{ flexGrow: d.failed }} />
                <div className="bg-border-strong" style={{ flexGrow: d.other }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-fg-subtle tabular" aria-hidden>
        <span>{fmt(daily[0]!.date)}</span>
        <span>{fmt(daily[daily.length - 1]!.date)}</span>
      </div>
      <figcaption className="text-sm text-fg-muted">
        {total} runs in the last 14 days, {failed} failed.
      </figcaption>
      <table className="sr-only">
        <caption>Runs per day, last 14 days</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Succeeded</th><th scope="col">Failed</th><th scope="col">Other</th></tr></thead>
        <tbody>{daily.map((d) => <tr key={d.date}><th scope="row">{fmt(d.date)}</th><td>{d.succeeded}</td><td>{d.failed}</td><td>{d.other}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export function DashboardView() {
  const workspaceId = useWorkspaceId();
  const { can, user } = useCurrent();
  const interval = useLiveInterval(20_000, 120_000);
  const q = useQuery({ queryKey: ["dashboard", workspaceId], queryFn: () => dashboardApi.get(), refetchInterval: interval });
  const [runOpen, setRunOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const d = q.data;

  const quickActions = [
    can("workflows.edit") && { label: "Create workflow", description: "Start from a trigger", icon: Plus, onClick: () => setCreateOpen(true) },
    can("runs.trigger") && { label: "Run a workflow", description: "Manual trigger with a payload", icon: Play, onClick: () => setRunOpen(true) },
    can("connections.manage") && { label: "Connect an integration", description: "Store a credential securely", icon: Blocks, href: "/integrations" },
    can("members.manage") && { label: "Invite a teammate", description: "Assign a role on invite", icon: UserPlus, href: "/settings/members?invite=1" },
  ].filter(Boolean) as Array<{ label: string; description: string; icon: React.ComponentType<{ className?: string }>; onClick?: () => void; href?: string }>;

  return (
    <PageContainer>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}${user ? `, ${user.name.split(" ")[0]}` : ""}`}
        description={d ? `${d.workspace.name} · ${ROLE_LABELS[d.workspace.role]} · Times shown in your local time zone` : "Workspace overview"}
        actions={
          <>
            {can("runs.trigger") && <Button variant="outline" onClick={() => setRunOpen(true)}><Play aria-hidden /> Run workflow</Button>}
            {can("workflows.edit") && <Button onClick={() => setCreateOpen(true)}><Plus aria-hidden /> New workflow</Button>}
          </>
        }
      />

      {q.isError && !d ? (
        <Panel><ErrorState title="Couldn't load the dashboard" error={q.error} onRetry={() => void q.refetch()} /></Panel>
      ) : (
        <div className="flex flex-col gap-5">
          {d && workspaceId && <GettingStarted data={d.gettingStarted} workspaceId={workspaceId} />}
          {d && d.pendingApprovals > 0 && can("approvals.decide") && (
            <Alert tone="warning" title={`${d.pendingApprovals} recovery action${d.pendingApprovals === 1 ? "" : "s"} waiting for approval`} action={<Button asChild size="sm" variant="outline"><Link href="/approvals">Review</Link></Button>}>
              The AI assistant proposed actions that need a person to approve before anything runs.
            </Alert>
          )}

          <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {!d ? (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-lg" />)
            ) : (
              <>
                <MetricCard label="Total workflows" value={d.totals.workflows} hint="Excluding archived" icon={<WorkflowIcon />} href="/workflows" />
                <MetricCard label="Active workflows" value={d.totals.active} hint="Accepting triggers" icon={<Zap />} href="/workflows?status=active" />
                <MetricCard label="Successful runs" value={d.totals.succeeded7d} hint="Last 7 days" icon={<CheckCircle2 />} delta={{ value: d.totals.succeeded7d - d.totals.prevSucceeded, label: "than the previous 7 days" }} href="/executions?status=succeeded" />
                <MetricCard label="Failed runs" value={d.totals.failed7d} hint={d.totals.successRate7d !== null ? `${(d.totals.successRate7d * 100).toFixed(1)}% success rate` : "Last 7 days"} icon={<XCircle />} deltaGoodWhen="down" delta={{ value: d.totals.failed7d - d.totals.prevFailed, label: "than the previous 7 days" }} href="/executions?status=failed" />
              </>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-3">
            <Panel className="lg:col-span-2" aria-labelledby="chart-h">
              <PanelHeader id="chart-h" title="Run volume" description="Last 14 days, by outcome" actions={<Button asChild variant="ghost" size="sm"><Link href="/executions">All executions <ArrowRight aria-hidden /></Link></Button>} />
              <div className="p-4">{d ? <RunsChart daily={d.daily} /> : <Skeleton className="h-52" />}</div>
            </Panel>

            <Panel aria-labelledby="fail-h" className="flex flex-col">
              <PanelHeader id="fail-h" title="Failure notifications" description="Open exceptions that need attention" />
              {!d ? (
                <div className="flex flex-col gap-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
              ) : d.failures.length === 0 ? (
                <EmptyState compact icon={<CheckCircle2 />} title="No open exceptions" description="Failed runs that need review will show up here." />
              ) : (
                <ul className="divide-y divide-border">
                  {d.failures.map((f) => (
                    <li key={f.runId} className="flex items-start gap-3 px-4 py-3">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <Link href={`/executions/${f.runId}`} className="font-medium hover:underline">{f.workflowName}</Link>
                        <span className="text-sm text-fg-muted">{f.step} · <Mono>{f.errorCode}</Mono></span>
                        <span className="text-xs text-fg-subtle"><RelativeTime iso={f.at} />{f.hasApproval && " · approval pending"}</span>
                      </div>
                      <Button asChild size="sm" variant="outline"><Link href={`/executions/${f.runId}#ai`}>Review<span className="sr-only"> {f.workflowName} failure</span></Link></Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Panel className="lg:col-span-2" aria-labelledby="recent-h">
              <PanelHeader id="recent-h" title="Recent workflow runs" actions={<Button asChild variant="ghost" size="sm"><Link href="/executions">View all <ArrowRight aria-hidden /></Link></Button>} />
              {!d ? (
                <div className="flex flex-col gap-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
              ) : d.recentRuns.length === 0 ? (
                <EmptyState compact icon={<Play />} title="No runs yet" description="Publish a workflow and trigger it to see runs here." />
              ) : (
                <ul className="divide-y divide-border">
                  {d.recentRuns.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                      <StatusBadge meta={RUN_STATUS_META[r.status]} />
                      <Link href={`/executions/${r.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{r.workflowName}</Link>
                      <span className="hidden font-mono text-xs text-fg-subtle sm:inline">{r.id}</span>
                      <span className="w-16 text-right text-sm text-fg-muted tabular">{r.endedAt ? formatDuration(r.startedAt, r.endedAt) : "—"}</span>
                      <RelativeTime iso={r.startedAt} className="w-24 text-right text-sm text-fg-muted" />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <div className="flex flex-col gap-5">
              <Panel aria-labelledby="qa-h">
                <PanelHeader id="qa-h" title="Quick actions" />
                {quickActions.length === 0 ? (
                  <p className="p-4 text-sm text-fg-muted">Your role has read-only access in this workspace.</p>
                ) : (
                  <ul className="grid gap-1 p-2">
                    {quickActions.map((a) => {
                      const inner = (
                        <>
                          <span className="flex size-8 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg"><a.icon className="size-4" /></span>
                          <span className="flex flex-col text-left"><span className="font-medium">{a.label}</span><span className="text-sm text-fg-muted">{a.description}</span></span>
                        </>
                      );
                      const cls = "flex w-full items-center gap-3 rounded-md p-2 hover:bg-surface-hover";
                      return <li key={a.label}>{a.href ? <Link href={a.href} className={cls}>{inner}</Link> : <button type="button" onClick={a.onClick} className={cls}>{inner}</button>}</li>;
                    })}
                  </ul>
                )}
              </Panel>
              <Panel aria-labelledby="ws-h">
                <PanelHeader id="ws-h" title="Workspace overview" description={d ? `${planName(d.workspace.plan)} plan · ${d.workspace.timezone}` : undefined} />
                <div className="flex flex-col gap-4 p-4">
                  {!d ? <Skeleton className="h-28" /> : (
                    <>
                      <Meter label="Executions this month" value={d.usage.executions} max={d.usage.quota} />
                      <Meter label="Members" value={d.usage.members} max={d.usage.memberQuota} />
                      <Meter label="Connections" value={d.usage.connections} max={d.usage.connectionQuota} hint={d.usage.connectionErrors ? `${d.usage.connectionErrors} connection${d.usage.connectionErrors === 1 ? "" : "s"} failing` : undefined} />
                    </>
                  )}
                </div>
              </Panel>
            </div>
          </div>

          <Panel aria-labelledby="act-h">
            <PanelHeader id="act-h" title="Recent activity" actions={can("audit.view") ? <Button asChild variant="ghost" size="sm"><Link href="/settings/audit-log">Audit log <ArrowRight aria-hidden /></Link></Button> : undefined} />
            {!d ? (
              <div className="flex flex-col gap-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : d.activity.length === 0 ? (
              <EmptyState compact icon={<ClipboardCheck />} title="No activity yet" />
            ) : (
              <ol className="divide-y divide-border">
                {d.activity.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
                    <Avatar name={e.actor.name} size="sm" className="mt-0.5" />
                    <p className="min-w-0 flex-1 text-base">
                      <span className="font-medium">{e.actor.name}</span> <span className="text-fg-muted">{describeAudit(e)}</span>
                    </p>
                    <RelativeTime iso={e.createdAt} className="shrink-0 text-sm text-fg-subtle" />
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      )}
      <RunWorkflowDialog open={runOpen} onOpenChange={setRunOpen} />
      <CreateWorkflowDialog open={createOpen} onOpenChange={setCreateOpen} />
    </PageContainer>
  );
}
