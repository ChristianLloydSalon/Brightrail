"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLiveInterval } from "@/lib/realtime";
import { AlertOctagon, Ban, ChevronRight, Copy, RefreshCw, RotateCcw, Sparkles, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { useAnnounce } from "@/components/providers/announcer";
import { Badge, StatusBadge, StatusIconGlyph } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DescriptionList, Mono, Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { JsonViewer, LogViewer } from "@/components/ui/code";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, ErrorState, LoadingBlock } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { SearchInput, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCurrent, useWorkspaceId } from "@/hooks/use-current";
import { NODE_META } from "@/lib/domain/nodes";
import { CANCELLABLE_RUN_STATUSES, RUN_STATUS_META, STEP_STATUS_META } from "@/lib/domain/status";
import type { LogLevel, StepRun, WorkflowRun } from "@/lib/domain/types";
import { ERROR_CLASS_LABELS } from "@/lib/engine/logic";
import { formatDateTime, formatDuration, formatTime } from "@/lib/format";
import { errorMessage, runsApi } from "@/lib/services";
import { cn } from "@/lib/utils";
import { AiAssistantPanel } from "@/features/ai/ai-assistant-panel";
import { TRIGGER_LABELS } from "./runs-table";

function useNow(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function stepStatusLabel(step: StepRun, run: WorkflowRun) {
  if (step.status === "pending" && (run.status === "failed" || run.status === "waiting_approval")) return "Not run";
  return STEP_STATUS_META[step.status].label;
}

function Timeline({ run, selected, onSelect, now }: { run: WorkflowRun; selected?: string; onSelect: (id: string) => void; now: number }) {
  const ref = React.useRef<HTMLOListElement>(null);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? run.steps.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const clamped = Math.max(0, Math.min(run.steps.length - 1, next));
    (ref.current?.querySelectorAll("button")[clamped] as HTMLButtonElement | undefined)?.focus();
    onSelect(run.steps[clamped]!.id);
  };
  return (
    <ol ref={ref} className="relative flex flex-col" aria-label="Execution timeline">
      {run.steps.map((s, i) => {
        const meta = STEP_STATUS_META[s.status];
        const active = s.id === selected;
        return (
          <li key={s.id} className="relative">
            {i < run.steps.length - 1 && <span className="absolute top-9 bottom-0 left-[27px] w-px bg-border" aria-hidden />}
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              onKeyDown={(e) => onKey(e, i)}
              aria-current={active ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${s.nodeLabel}, ${stepStatusLabel(s, run)}${s.attempt > 1 ? `, ${s.attempt} attempts` : ""}`}
              className={cn("relative flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-surface-hover", active && "bg-secondary-soft hover:bg-secondary-soft")}
            >
              <span className={cn("z-[1] mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border bg-surface",
                s.status === "succeeded" && "border-success-border text-success", s.status === "failed" && "border-danger-border bg-danger-soft text-danger",
                (s.status === "running" || s.status === "retrying") && "border-info-border text-info", (s.status === "pending" || s.status === "skipped" || s.status === "cancelled") && "border-border text-fg-subtle")} aria-hidden>
                <StatusIconGlyph icon={meta.icon} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.nodeLabel}</span>
                  {s.branch && <Badge tone="neutral" className="h-5 px-1 text-xs">{s.branch} branch</Badge>}
                </span>
                <span className="text-sm text-fg-muted">
                  {NODE_META[s.nodeKind].label} · {stepStatusLabel(s, run)}
                  {s.attempt > 1 && ` · ${s.attempt} attempts`}
                  {s.startedAt && ` · ${formatDuration(s.startedAt, s.endedAt, now)}`}
                </span>
                {s.errorCode && s.status !== "succeeded" && <span className="font-mono text-xs text-danger-fg dark:text-danger">{s.errorCode}</span>}
              </span>
              <ChevronRight className="mt-1 size-4 shrink-0 text-fg-subtle lg:hidden" aria-hidden />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepDetails({ step, run, now }: { step: StepRun; run: WorkflowRun; now: number }) {
  const logs = run.logs.filter((l) => l.stepId === step.id);
  return (
    <Panel aria-labelledby="step-h" className="min-w-0">
      <PanelHeader id="step-h" title={step.nodeLabel} description={`${NODE_META[step.nodeKind].label} · ${stepStatusLabel(step, run)}`} actions={<StatusBadge meta={STEP_STATUS_META[step.status]} label={stepStatusLabel(step, run)} />} />
      <PanelBody className="flex flex-col gap-4">
        <DescriptionList columns={3} items={[
          { term: "Started", value: step.startedAt ? formatTime(step.startedAt) : "—" },
          { term: "Completed", value: step.endedAt ? formatTime(step.endedAt) : "—" },
          { term: "Duration", value: formatDuration(step.startedAt, step.endedAt, now) },
        ]} />
        {step.status === "failed" && (
          <Alert tone="danger" title={step.errorCode ?? "Step failed"}>
            {step.errorMessage}
            {step.errorClass && <p className="mt-1 text-sm">Classified as <strong>{ERROR_CLASS_LABELS[step.errorClass].toLowerCase()}</strong>{step.errorClass === "transient" ? ": safe to retry once the provider recovers." : step.errorClass === "permission" ? ": fix the credential before retrying." : step.errorClass === "validation" ? ": retrying with the same input will fail again." : "."}</p>}
          </Alert>
        )}
        <Tabs defaultValue={step.status === "failed" ? "attempts" : "input"} key={step.id}>
          <TabsList variant="pill" aria-label="Step data">
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="attempts">Attempts ({step.attempts.length})</TabsTrigger>
            <TabsTrigger value="logs">Logs ({logs.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="input"><JsonViewer value={step.input} label="Input" /></TabsContent>
          <TabsContent value="output"><JsonViewer value={step.output} label="Output" /></TabsContent>
          <TabsContent value="attempts">
            {step.attempts.length === 0 ? <p className="text-sm text-fg-muted">This step hasn't started.</p> : (
              <div className="overflow-x-auto rounded-md border border-border" tabIndex={0} role="region" aria-label={`Attempts for ${step.nodeLabel}`}>
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Attempts for {step.nodeLabel}</caption>
                  <thead className="bg-surface-sunken text-fg-muted"><tr><th scope="col" className="px-3 py-2 font-medium">#</th><th scope="col" className="px-3 py-2 font-medium">Result</th><th scope="col" className="px-3 py-2 font-medium">Started</th><th scope="col" className="px-3 py-2 font-medium">Duration</th><th scope="col" className="px-3 py-2 font-medium">Idempotency key</th></tr></thead>
                  <tbody>
                    {step.attempts.map((a) => (
                      <tr key={a.attempt} className="border-t border-border">
                        <td className="px-3 py-2 tabular">{a.attempt}</td>
                        <td className="px-3 py-2">{a.status === "failed" ? <span className="text-danger-fg dark:text-danger">Failed · {a.errorCode}</span> : a.status === "running" ? "Running" : "Succeeded"}</td>
                        <td className="px-3 py-2 tabular">{formatTime(a.startedAt)}</td>
                        <td className="px-3 py-2 tabular">{formatDuration(a.startedAt, a.endedAt, now)}</td>
                        <td className="px-3 py-2"><Mono>{a.idempotencyKey}</Mono></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {step.attempts.length > 1 && <p className="mt-2 text-sm text-fg-muted">Every attempt used the same idempotency key, so a provider that accepted an earlier attempt returns the original result instead of repeating the side effect.</p>}
          </TabsContent>
          <TabsContent value="logs"><LogViewer logs={logs} /></TabsContent>
        </Tabs>
      </PanelBody>
    </Panel>
  );
}

function RunLogs({ run }: { run: WorkflowRun }) {
  const [level, setLevel] = React.useState<"all" | LogLevel>("all");
  const [stepId, setStepId] = React.useState("all");
  const [q, setQ] = React.useState("");
  const order: LogLevel[] = ["debug", "info", "warn", "error"];
  const logs = run.logs.filter((l) => (level === "all" || order.indexOf(l.level) >= order.indexOf(level)) && (stepId === "all" || l.stepId === stepId) && (!q || l.message.toLowerCase().includes(q.toLowerCase())));
  const label = (id?: string) => run.steps.find((s) => s.id === id)?.nodeLabel;
  return (
    <Panel aria-labelledby="logs-h">
      <PanelHeader id="logs-h" title="Logs" description="Structured, redacted worker logs with correlation IDs" />
      <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row">
        <SearchInput label="Search logs" value={q} onValueChange={setQ} className="sm:w-64" />
        <Select aria-label="Minimum log level" value={level} onValueChange={setLevel} className="sm:w-40" options={[{ value: "all", label: "All levels" }, { value: "info", label: "Info and above" }, { value: "warn", label: "Warnings and errors" }, { value: "error", label: "Errors only" }]} />
        <Select aria-label="Filter by step" value={stepId} onValueChange={setStepId} className="sm:w-56" options={[{ value: "all", label: "All steps" }, ...run.steps.filter((s) => run.logs.some((l) => l.stepId === s.id)).map((s) => ({ value: s.id, label: s.nodeLabel }))]} />
      </div>
      <PanelBody><LogViewer logs={logs} stepLabel={label} /></PanelBody>
    </Panel>
  );
}

export function RunDetailView({ id }: { id: string }) {
  const ws = useWorkspaceId();
  const qc = useQueryClient();
  const router = useRouter();
  const { can } = useCurrent();
  const active = useLiveInterval(1500, 15_000);
  const q = useQuery({
    queryKey: ["run", ws, id],
    queryFn: () => runsApi.get(id),
    // Realtime pushes changes; poll as a fallback while the run is active, stop once it's terminal.
    refetchInterval: (query) => (["queued", "running", "retrying"].includes(query.state.data?.run.status ?? "") ? active : false),
  });
  const run = q.data?.run;
  const prevStatus = React.useRef<string | undefined>(undefined);
  const announce = useAnnounce();
  React.useEffect(() => {
    const st = run?.status;
    if (prevStatus.current && st && prevStatus.current !== st) {
      const label = RUN_STATUS_META[st].label;
      announce(`Run ${label.toLowerCase()}.`, st === "failed" ? "assertive" : "polite");
      if (st === "succeeded") toast.success("Run succeeded");
      if (st === "failed") toast.error("Run failed", { description: "Open the failed step or ask the AI assistant for help." });
    }
    prevStatus.current = st;
  }, [run?.status, announce]);
  const now = useNow(!!run && !run.endedAt);
  const [selected, setSelected] = React.useState<string>();
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [retryOpen, setRetryOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const detailsRef = React.useRef<HTMLDivElement>(null);

  const failed = run?.steps.find((s) => s.status === "failed");
  // Default to the failed/active step until the person picks one.
  const effectiveSelected = run && selected && run.steps.some((s) => s.id === selected) ? selected : (run?.steps.find((s) => s.status === "failed" || s.status === "running" || s.status === "retrying") ?? run?.steps[0])?.id;

  const cancel = useMutation({ mutationFn: () => runsApi.cancel(id, reason), onSuccess: async () => { await qc.invalidateQueries(); setCancelOpen(false); toast.success("Run cancelled"); }, onError: (e) => toast.error(errorMessage(e)) });
  const retry = useMutation({ mutationFn: () => runsApi.retryStep(id, failed!.id), onSuccess: async () => { await qc.invalidateQueries(); setRetryOpen(false); toast.success("Retry started", { description: "The failed step is running again with the same idempotency key." }); }, onError: (e) => toast.error(errorMessage(e)) });
  const rerun = useMutation({ mutationFn: () => runsApi.rerun(id), onSuccess: (r) => { void qc.invalidateQueries(); toast.success("New run started"); router.push(`/executions/${r.id}`); }, onError: (e) => toast.error(errorMessage(e)) });

  if (q.isError) return <PageContainer><Panel><ErrorState title="Couldn't load this run" error={q.error} onRetry={() => void q.refetch()} /></Panel></PageContainer>;
  if (!q.data || !run) return <PageContainer><LoadingBlock rows={6} label="Loading run" /></PageContainer>;

  const step = run.steps.find((s) => s.id === effectiveSelected) ?? run.steps[0]!;
  const cancellable = CANCELLABLE_RUN_STATUSES.includes(run.status);
  const retryable = run.status === "failed" && failed && failed.errorClass !== "permission" && failed.errorClass !== "validation";
  const pendingApproval = q.data.approvals.find((a) => a.status === "pending");

  return (
    <PageContainer wide>
      <PageHeader
        breadcrumbs={[{ label: "Executions", href: "/executions" }, { label: run.id }]}
        title={run.workflowName}
        meta={
          <>
            <StatusBadge meta={RUN_STATUS_META[run.status]} />
            <Badge tone="neutral">v{run.version}</Badge>
            <Badge tone="neutral">{TRIGGER_LABELS[run.trigger.source]} trigger</Badge>
            <span className="font-mono text-sm text-fg-subtle">{run.id}</span>
          </>
        }
        actions={
          <>
            <Button asChild variant="ghost"><Link href={`/workflows/${run.workflowId}`}><WorkflowIcon aria-hidden /> Workflow</Link></Button>
            {can("runs.trigger") && q.data.workflowStatus === "active" && run.endedAt && <Button variant="outline" onClick={() => rerun.mutate()} loading={rerun.isPending}><RefreshCw aria-hidden /> Re-run</Button>}
            {can("runs.cancel") && cancellable && <Button variant="destructive-outline" onClick={() => setCancelOpen(true)}><Ban aria-hidden /> Cancel run</Button>}
            {can("runs.retry") && retryable && <Button onClick={() => setRetryOpen(true)}><RotateCcw aria-hidden /> Retry failed step</Button>}
          </>
        }
      />
      <p className="sr-only" aria-live="polite">Run status: {RUN_STATUS_META[run.status].label}</p>

      <div className="flex flex-col gap-5">
        {failed && (run.status === "failed" || run.status === "waiting_approval") && (
          <Alert tone="danger" title={`Failed at “${failed.nodeLabel}”`}
            action={<>
              <Button size="sm" variant="outline" onClick={() => document.getElementById("ai")?.scrollIntoView({ behavior: "smooth" })}><Sparkles aria-hidden /> Analyze with AI</Button>
              <Button size="sm" variant="outline" onClick={() => { setSelected(failed.id); detailsRef.current?.focus(); }}>Inspect step</Button>
            </>}>
            <p><Mono>{failed.errorCode}</Mono> {failed.errorMessage}</p>
            <p className="mt-1 text-sm">
              {failed.attempts.length} attempt{failed.attempts.length === 1 ? "" : "s"} used{failed.errorClass ? ` · ${ERROR_CLASS_LABELS[failed.errorClass]} error` : ""}
              {run.status === "waiting_approval" && pendingApproval ? " · A recovery action is waiting for approval." : retryable ? " · Eligible for retry." : failed.errorClass === "permission" ? " · Not retryable until the credential is fixed." : failed.errorClass === "validation" ? " · Not retryable with the same input." : ""}
            </p>
          </Alert>
        )}
        {run.status === "succeeded" && run.exception?.status === "resolved" && <Alert tone="success" title="Recovered">An earlier failure in this run was retried and the run completed. Completed side effects were not repeated.</Alert>}

        <Panel aria-labelledby="sum-h">
          <PanelHeader id="sum-h" title="Summary" />
          <PanelBody>
            <DescriptionList columns={3} items={[
              { term: "Status", value: RUN_STATUS_META[run.status].description },
              { term: "Started", value: formatDateTime(run.startedAt) },
              { term: "Completed", value: run.endedAt ? formatDateTime(run.endedAt) : "In progress" },
              { term: "Duration", value: <span className="tabular">{formatDuration(run.startedAt, run.endedAt, now)}</span> },
              { term: "Trigger source", value: run.trigger.detail },
              { term: "Pinned version", value: <Link className="text-link hover:underline" href={`/workflows/${run.workflowId}/edit?version=${run.version}`}>v{run.version}</Link> },
              { term: "Temporal workflow ID", value: <Mono>{run.temporalWorkflowId}</Mono> },
              { term: "Correlation ID", value: <Mono>{run.correlationId}</Mono> },
              { term: "Retry information", value: run.steps.some((s) => s.attempt > 1) ? `${run.steps.filter((s) => s.attempt > 1).map((s) => `${s.nodeLabel}: ${s.attempt} attempts`).join("; ")}` : "No retries" },
            ]} />
          </PanelBody>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          <Panel aria-labelledby="tl-h" className="h-fit">
            <PanelHeader id="tl-h" title="Execution timeline" description="Use arrow keys to move between steps" />
            <div className="p-2"><Timeline run={run} selected={step.id} onSelect={setSelected} now={now} /></div>
          </Panel>
          <div ref={detailsRef} tabIndex={-1} className="min-w-0 outline-none"><StepDetails step={step} run={run} now={now} /></div>
        </div>

        <Panel aria-labelledby="input-h">
          <PanelHeader id="input-h" title="Trigger payload" description="As stored, after redaction" actions={<Button variant="ghost" size="sm" onClick={() => void navigator.clipboard?.writeText(run.id).then(() => toast.success("Run ID copied"))}><Copy aria-hidden /> Copy run ID</Button>} />
          <PanelBody><JsonViewer value={run.input} label="Payload" maxHeight="max-h-60" /></PanelBody>
        </Panel>

        {(failed || q.data.analyses.length > 0) && (
          <div id="ai" className="scroll-mt-20">
            <AiAssistantPanel run={run} analyses={q.data.analyses} approvals={q.data.approvals} />
          </div>
        )}

        <RunLogs run={run} />
      </div>

      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} destructive title="Cancel this run?" confirmLabel="Cancel run" loading={cancel.isPending} onConfirm={() => cancel.mutate()}
        description="In-flight activities are asked to stop at their next heartbeat. Steps that already completed are not rolled back.">
        <Field label="Reason" optional>{(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the audit log" />}</Field>
      </ConfirmDialog>
      <ConfirmDialog open={retryOpen} onOpenChange={setRetryOpen} title={`Retry “${failed?.nodeLabel}”?`} confirmLabel="Retry step" loading={retry.isPending} onConfirm={() => retry.mutate()}
        description="Only the failed step runs again, with the same idempotency key. Completed steps are not repeated, and the run continues from there.">
        <Alert tone="info"><AlertOctagon className="hidden" aria-hidden />Check that the provider has recovered first. If the destination doesn't support idempotency, reconcile its state before retrying.</Alert>
      </ConfirmDialog>
    </PageContainer>
  );
}
