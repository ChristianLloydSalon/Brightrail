"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, ChevronDown, FlaskConical, GitCommitVertical, MousePointerClick, Pause, Pencil, Play, Rocket, Timer, Webhook } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { RelativeTime } from "@/components/shared/time";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DescriptionList, Mono, Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrent, useWorkspaceId } from "@/hooks/use-current";
import { NODE_META, summarizeNode } from "@/lib/domain/nodes";
import { describeSchedule } from "@/lib/engine/schedule";
import type { TriggerConfig } from "@/lib/domain/types";
import { WORKFLOW_STATUS_META } from "@/lib/domain/status";
import { formatDateTime, formatMs } from "@/lib/format";
import { errorMessage, workflowsApi } from "@/lib/services";
import { RUN_FILTER_DEFAULTS, RunsTable, type RunsFilter } from "@/features/executions/runs-table";
import { PublishDialog } from "./publish-dialog";
import { RunWorkflowDialog } from "./run-workflow-dialog";


export function WorkflowDetailView({ id }: { id: string }) {
  const ws = useWorkspaceId();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useCurrent();
  const q = useQuery({ queryKey: ["workflow", ws, id], queryFn: () => workflowsApi.get(id) });
  const [runOpen, setRunOpen] = React.useState(false);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState<null | "pause" | "archive">(null);
  const [tab, setTab] = React.useState("overview");
  const [runFilter, setRunFilter] = React.useState<RunsFilter>({ ...RUN_FILTER_DEFAULTS, size: "10" });

  const status = useMutation({
    mutationFn: (s: "active" | "paused" | "archived") => workflowsApi.setStatus(id, s),
    onSuccess: async (wf) => { await qc.invalidateQueries(); setConfirm(null); toast.success(wf.status === "paused" ? "Workflow paused" : wf.status === "archived" ? "Workflow archived" : "Workflow resumed", { description: wf.status === "paused" ? "New triggers are rejected until you resume. In-flight runs continue." : undefined }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isError) return <PageContainer><Panel><ErrorState title="Couldn't load this workflow" error={q.error} onRetry={() => void q.refetch()} /></Panel><p className="mt-4"><Link href="/workflows" className="text-link hover:underline">Back to workflows</Link></p></PageContainer>;
  if (!q.data) return <PageContainer><LoadingBlock rows={6} label="Loading workflow" /></PageContainer>;

  const { workflow: wf, owner, versions, currentVersion, webhook, stats, hasUnpublishedChanges } = q.data;
  const trigger = wf.draft.nodes.find((n) => n.kind === "trigger");
  const pubTrigger = currentVersion?.definition.nodes.find((n) => n.kind === "trigger");
  const triggerCfg = (pubTrigger ?? trigger)?.kind === "trigger" ? (pubTrigger ?? trigger)!.config as TriggerConfig : null;
  const archived = wf.status === "archived";
  const nextVersion = (versions[0]?.version ?? 0) + 1;

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={[{ label: "Workflows", href: "/workflows" }, { label: wf.name }]}
        title={wf.name}
        description={wf.description}
        meta={
          <>
            <StatusBadge meta={WORKFLOW_STATUS_META[wf.status]} />
            {currentVersion ? <Badge tone="neutral"><GitCommitVertical className="size-3.5" aria-hidden />v{currentVersion.version} published</Badge> : <Badge tone="neutral">Never published</Badge>}
            {hasUnpublishedChanges && !archived && <Badge tone="warning"><Pencil className="size-3.5" aria-hidden />Unpublished draft changes</Badge>}
            {wf.tags.map((t) => <Badge key={t} tone="primary" className="font-normal">{t}</Badge>)}
          </>
        }
        actions={
          <>
            {can("runs.trigger") && wf.status === "active" && <Button variant="outline" onClick={() => setRunOpen(true)}><Play aria-hidden /> Run now</Button>}
            {can("workflows.edit") && !archived && <Button variant="outline" onClick={() => router.push(`/workflows/${id}/edit`)}><Pencil aria-hidden /> Edit</Button>}
            {can("workflows.publish") && !archived && (
              <Button onClick={() => setPublishOpen(true)} disabled={!hasUnpublishedChanges} title={!hasUnpublishedChanges ? "The draft matches the published version" : undefined}><Rocket aria-hidden /> Publish</Button>
            )}
            {can("workflows.edit") && !archived && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" size="icon" aria-label="More workflow actions"><ChevronDown aria-hidden /></Button></DropdownMenuTrigger>
                <DropdownMenuContent>
                  {wf.status === "active" && <DropdownMenuItem onSelect={() => setConfirm("pause")}><Pause aria-hidden /> Pause workflow</DropdownMenuItem>}
                  {wf.status === "paused" && <DropdownMenuItem onSelect={() => status.mutate("active")}><Play aria-hidden /> Resume workflow</DropdownMenuItem>}
                  <DropdownMenuItem destructive onSelect={() => setConfirm("archive")}><Archive aria-hidden /> Archive workflow</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {wf.status === "paused" && (
        <Alert tone="warning" className="mb-5" title="This workflow is paused" action={can("workflows.edit") && <Button size="sm" variant="outline" loading={status.isPending} onClick={() => status.mutate("active")}><Play aria-hidden /> Resume</Button>}>
          New webhook deliveries are rejected and manual runs are disabled. Runs already in progress continue.
        </Alert>
      )}
      {archived && <Alert tone="info" className="mb-5" title="Archived">This workflow is read-only and kept for audit history.</Alert>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Workflow sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="versions">Versions <Badge tone="neutral" className="h-5 px-1.5">{versions.length}</Badge></TabsTrigger>
          <TabsTrigger value="executions">Executions <Badge tone="neutral" className="h-5 px-1.5">{stats.total}</Badge></TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-5 lg:grid-cols-3">
          <div className="flex flex-col gap-5 lg:col-span-2">
            <Panel aria-labelledby="info-h">
              <PanelHeader id="info-h" title="Workflow information" />
              <PanelBody>
                <DescriptionList items={[
                  { term: "Owner", value: `${owner.name}` },
                  { term: "Status", value: WORKFLOW_STATUS_META[wf.status].description },
                  { term: "Created", value: formatDateTime(wf.createdAt) },
                  { term: "Draft last saved", value: <><RelativeTime iso={wf.draftUpdatedAt} /> · revision <Mono>r{wf.draftRevision}</Mono></> },
                  { term: "Published version", value: currentVersion ? <>v{currentVersion.version} · <Mono>{currentVersion.checksum}</Mono></> : "None" },
                  { term: "Workflow ID", value: <Mono>{wf.id}</Mono> },
                ]} />
              </PanelBody>
            </Panel>
            <Panel aria-labelledby="steps-h">
              <PanelHeader id="steps-h" title={currentVersion ? `Steps in v${currentVersion.version}` : "Steps in draft"} description="Execution order from the trigger" actions={can("workflows.edit") && !archived && <Button asChild size="sm" variant="ghost"><Link href={`/workflows/${id}/edit`}>Open editor</Link></Button>} />
              <ol className="divide-y divide-border">
                {(currentVersion?.definition ?? wf.draft).nodes.map((n, i) => (
                  <li key={n.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-5 text-right text-sm text-fg-subtle tabular">{i + 1}</span>
                    <Badge tone={n.kind === "trigger" ? "primary" : n.kind === "errorHandler" ? "danger" : "neutral"} className="w-20 justify-center">{NODE_META[n.kind].shortLabel}</Badge>
                    <span className="flex min-w-0 flex-col"><span className="font-medium">{n.label}</span><span className="truncate text-sm text-fg-muted">{summarizeNode(n)}</span></span>
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
          <div className="flex flex-col gap-5">
            <Panel aria-labelledby="trig-h">
              <PanelHeader id="trig-h" title="Trigger" />
              <PanelBody className="flex flex-col gap-3">
                {triggerCfg ? (
                  <>
                    <p className="flex items-center gap-2 font-medium">{triggerCfg.triggerType === "webhook" ? <Webhook className="size-4" aria-hidden /> : triggerCfg.triggerType === "schedule" ? <Timer className="size-4" aria-hidden /> : <MousePointerClick className="size-4" aria-hidden />}{triggerCfg.triggerType === "webhook" ? "Signed webhook" : triggerCfg.triggerType === "schedule" ? "Schedule" : "Manual run"}</p>
                    {triggerCfg.triggerType === "schedule" && (
                      <div className="flex flex-col gap-1 text-sm">
                        <p>{describeSchedule(triggerCfg.schedule)}</p>
                        {q.data.schedule?.enabled && q.data.schedule.nextRunAt ? (
                          <p className="text-fg-muted">{q.data.schedule.runOnce ? "Runs" : "Next run"} <RelativeTime iso={q.data.schedule.nextRunAt} /></p>
                        ) : q.data.schedule?.runOnce && q.data.schedule.lastRunAt ? (
                          <p className="text-fg-muted">Done — it ran once and won&apos;t run again. To run it again, set a new date in the trigger and publish.</p>
                        ) : (
                          <p className="text-fg-muted">{wf.status === "paused" ? "Paused — resume the workflow to start the schedule again." : wf.status === "active" ? "Not scheduled yet. Publish again to arm it." : "Starts after you publish."}</p>
                        )}
                        {q.data.schedule?.lastRunAt && <p className="text-fg-muted">Last run <RelativeTime iso={q.data.schedule.lastRunAt} />{q.data.schedule.lastRunId && <> · <Link href={`/executions/${q.data.schedule.lastRunId}`} className="text-link hover:underline">view</Link></>}</p>}
                        {q.data.schedule?.lastError && <Alert tone="warning">{q.data.schedule.lastError}</Alert>}
                      </div>
                    )}
                    {triggerCfg.eventName && <p className="text-sm text-fg-muted">Event <Mono>{triggerCfg.eventName}</Mono></p>}
                    {triggerCfg.requiredFields.length > 0 && <p className="text-sm text-fg-muted">Required fields: {triggerCfg.requiredFields.map((f) => <Mono key={f} className="mr-1">{f}</Mono>)}</p>}
                    {triggerCfg.triggerType === "webhook" && (webhook ? (
                      <Link href={`/integrations/webhooks/${webhook.id}`} className="text-sm text-link hover:underline">Endpoint: {webhook.name} ({webhook.status})</Link>
                    ) : <Alert tone="warning">No webhook endpoint yet. <Link href="/integrations/webhooks?new=1">Create one</Link> to receive events.</Alert>)}
                  </>
                ) : <p className="text-sm text-fg-muted">No trigger configured.</p>}
              </PanelBody>
            </Panel>
            <Panel aria-labelledby="stats-h">
              <PanelHeader id="stats-h" title="Execution summary" description="All time" />
              <PanelBody>
                <DescriptionList columns={2} items={[
                  { term: "Total runs", value: <span className="tabular">{stats.total}</span> },
                  { term: "Succeeded", value: <span className="inline-flex items-center gap-1 tabular"><CheckCircle2 className="size-4 text-success" aria-hidden />{stats.succeeded}</span> },
                  { term: "Failed", value: <span className="tabular">{stats.failed}</span> },
                  { term: "Avg duration", value: stats.avgDurationMs ? formatMs(stats.avgDurationMs) : "—" },
                ]} />
              </PanelBody>
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="versions">
          <Panel aria-labelledby="ver-h">
            <PanelHeader id="ver-h" title="Version history" description="Published versions are immutable. Runs reference the exact version they started on." />
            {versions.length === 0 ? (
              <p className="p-6 text-center text-base text-fg-muted">Not published yet. Validate the draft and publish to create version 1.</p>
            ) : (
              <ol className="divide-y divide-border">
                {versions.map((v) => (
                  <li key={v.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
                    <div className="flex items-center gap-2 sm:w-40">
                      <span className="font-semibold">Version {v.version}</span>
                      {v.id === currentVersion?.id && <Badge tone="success">Current</Badge>}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <p>{v.changeNote}</p>
                      <p className="text-sm text-fg-muted">{v.publishedByName} · {formatDateTime(v.publishedAt)} · {v.definition.nodes.length} steps · <Mono>{v.checksum}</Mono></p>
                    </div>
                    <Button asChild variant="ghost" size="sm"><Link href={`/workflows/${id}/edit?version=${v.version}`}>View<span className="sr-only"> version {v.version}</span></Link></Button>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="executions">
          <Panel><RunsTable state={runFilter} set={(p) => setRunFilter((s) => ({ ...s, ...p }))} workflowId={id} compact /></Panel>
        </TabsContent>
      </Tabs>

      <RunWorkflowDialog open={runOpen} onOpenChange={setRunOpen} workflowId={id} />
      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} workflowId={id} revision={wf.draftRevision} nextVersion={nextVersion} onFixIssue={(nodeId) => router.push(`/workflows/${id}/edit?node=${nodeId}`)} />
      <ConfirmDialog
        open={confirm === "pause"} onOpenChange={(o) => !o && setConfirm(null)}
        title="Pause this workflow?" description="New triggers will be rejected until you resume it. Runs already in progress will finish."
        confirmLabel="Pause workflow" loading={status.isPending} onConfirm={() => status.mutate("paused")}
      />
      <ConfirmDialog
        open={confirm === "archive"} onOpenChange={(o) => !o && setConfirm(null)} destructive
        title="Archive this workflow?" description="It becomes read-only and stops accepting triggers. This can't be undone; history is kept for audit."
        confirmLabel="Archive workflow" confirmText={wf.name} loading={status.isPending} onConfirm={() => status.mutate("archived")}
      />
    </PageContainer>
  );
}
