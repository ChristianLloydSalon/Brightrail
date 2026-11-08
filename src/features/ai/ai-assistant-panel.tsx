"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOnChange } from "@/hooks/use-on-change";
import { CheckCircle2, ExternalLink, History, Loader2, ShieldCheck, ShieldAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { useAnnounce } from "@/components/providers/announcer";
import { RelativeTime } from "@/components/shared/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code";
import { Alert, EmptyState } from "@/components/ui/feedback";
import { useCurrent } from "@/hooks/use-current";
import { ADVISOR_STAGES } from "@/lib/ai/advisor";
import { RUN_STATUS_META } from "@/lib/domain/status";
import type { AiAnalysis, ApprovalRequest, WorkflowRun } from "@/lib/domain/types";
import { ERROR_CLASS_LABELS } from "@/lib/engine/logic";
import { aiApi, errorMessage } from "@/lib/services";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./approval-card";

function Stages({ active }: { active: boolean }) {
  const [i, setI] = React.useState(0);
  useOnChange(active, (a) => { if (!a) setI(0); });
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setI((x) => Math.min(ADVISOR_STAGES.length - 1, x + 1)), 260);
    return () => clearInterval(id);
  }, [active]);
  return (
    <ol className="flex flex-col gap-2" role="status" aria-label="Analysis progress">
      {ADVISOR_STAGES.map((s, idx) => (
        <li key={s} className={cn("flex items-center gap-2 text-base", idx > i && "text-fg-subtle")}>
          {idx < i ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : idx === i ? <Loader2 className="size-4 animate-spin text-info" aria-hidden /> : <span className="size-4 rounded-full border border-border" aria-hidden />}
          {s}{idx < i && <span className="sr-only"> (done)</span>}
        </li>
      ))}
    </ol>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-1.5"><h3 className="text-sm font-semibold tracking-wide text-fg-muted uppercase">{title}</h3>{children}</section>;
}

function AnalysisView({ a, run, approvals }: { a: AiAnalysis; run: WorkflowRun; approvals: ApprovalRequest[] }) {
  const { can } = useCurrent();
  const qc = useQueryClient();
  const announce = useAnnounce();
  const approval = approvals.find((x) => x.id === a.approvalRequestId);
  const request = useMutation({
    mutationFn: () => aiApi.requestApproval(a.id),
    onSuccess: async () => { await qc.invalidateQueries(); toast.success("Approval requested", { description: "An authorized approver must approve before the retry runs." }); announce("Approval request created. The run is waiting for approval."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rec = a.recommendation;
  const stepId = rec.toolCall.args.node_id;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{ERROR_CLASS_LABELS[a.classification]} failure</Badge>
          <Badge tone={a.confidence === "high" ? "success" : a.confidence === "medium" ? "warning" : "neutral"}>{a.confidence} confidence</Badge>
          <span className="text-sm text-fg-subtle"><RelativeTime iso={a.createdAt} /> · {a.model} · {a.promptVersion}</span>
        </div>
        <p className="text-md font-medium">{a.summary}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="What happened"><p>{a.explanation}</p></Section>
        <Section title="Likely root cause"><p>{a.rootCause}</p></Section>
      </div>
      <Section title="Supporting execution data">
        <ul className="divide-y divide-border rounded-md border border-border">
          {a.evidence.map((e) => (
            <li key={e.label} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[160px_1fr_auto] sm:items-center sm:gap-3">
              <span className="text-sm font-medium">{e.label}</span>
              <span className="min-w-0 text-sm break-words">{e.value}</span>
              <span className="font-mono text-xs text-fg-subtle">{e.source}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Recommended recovery">
        <div className="flex flex-col gap-3 rounded-md border border-primary-border bg-primary-soft/40 p-4">
          <p className="font-semibold">{rec.title}</p>
          <p>{rec.description}</p>
          <div>
            <p className="mb-1 text-sm font-medium">Proposed action preview</p>
            <CodeBlock code={JSON.stringify(rec.toolCall, null, 2)} />
            <ul className="mt-2 list-disc pl-5 text-sm text-fg-muted">{rec.effects.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
          <div className={cn("flex items-start gap-2 rounded-md p-3 text-sm", a.policy.allowed ? "bg-surface" : "bg-danger-soft text-danger-fg")}>
            {a.policy.allowed ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <div>
              <p className="font-medium">Policy check: {a.policy.allowed ? (a.policy.requiresApproval ? "allowed with human approval" : "allowed, no automated action") : "blocked"}</p>
              <ul className="list-disc pl-4">{a.policy.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          </div>
          {rec.actionType === "retry_failed_step" && a.policy.allowed && !approval && (run.status === "failed") && (
            can("runs.trigger") ? (
              <Button className="w-fit" onClick={() => request.mutate()} loading={request.isPending}>Request approval to retry</Button>
            ) : <p className="text-sm text-fg-muted">Your role can't request recovery actions.</p>
          )}
          {rec.actionType === "reconnect_credential" && <Button asChild variant="outline" className="w-fit"><Link href={`/integrations/connections/${rec.toolCall.args.connection_id}`}><ExternalLink aria-hidden /> Open credential settings</Link></Button>}
          {rec.actionType === "correct_field" && <Button asChild variant="outline" className="w-fit"><Link href={`/workflows/${run.workflowId}/edit${stepId ? `?node=${stepId}` : ""}`}><ExternalLink aria-hidden /> Open editor at this step</Link></Button>}
          {a.alternatives.length > 0 && (
            <div className="text-sm"><p className="font-medium">Alternatives</p><ul className="list-disc pl-5 text-fg-muted">{a.alternatives.map((x) => <li key={x.title}><span className="text-fg">{x.title}.</span> {x.description}</li>)}</ul></div>
          )}
        </div>
      </Section>
      {approval && <Section title="Approval"><ApprovalCard approval={approval} /></Section>}
      {approval?.status === "approved" && (
        <Alert tone={run.status === "succeeded" ? "success" : run.status === "failed" ? "danger" : "info"} role="status" title="Verify the outcome">
          Run status is now <strong>{RUN_STATUS_META[run.status].label.toLowerCase()}</strong>.{run.status === "succeeded" ? " The failed step completed and the remaining steps ran on the pinned version." : run.status === "failed" ? " The step failed again; investigate before retrying." : " The retry is in progress."}
        </Alert>
      )}
    </div>
  );
}

/** AI-01: advisory exception resolution with explicit human approval for consequential actions. */
export function AiAssistantPanel({ run, analyses, approvals }: { run: WorkflowRun; analyses: AiAnalysis[]; approvals: ApprovalRequest[] }) {
  const qc = useQueryClient();
  const announce = useAnnounce();
  const { workspace } = useCurrent();
  const analyze = useMutation({
    mutationFn: () => aiApi.analyze(run.id),
    onSuccess: async (a) => { await qc.invalidateQueries(); announce(`Analysis ready: ${a.summary}`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const latest = analyses[0];
  const failed = run.steps.some((s) => s.status === "failed");
  const enabled = workspace?.settings.aiAssistantEnabled !== false;

  return (
    <Panel aria-labelledby="ai-h">
      <PanelHeader
        id="ai-h"
        title={<span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-primary" aria-hidden />AI exception assistant</span>}
        description="Advisory only. Reads sanitized run data and proposes actions from a fixed catalogue. It can't run requests, read secrets or change anything without approval."
        actions={failed && enabled && latest && <Button variant="outline" size="sm" onClick={() => analyze.mutate()} loading={analyze.isPending}>Re-analyze</Button>}
      />
      <PanelBody className="flex flex-col gap-5">
        {!enabled ? (
          <Alert tone="info" title="The AI assistant is turned off">An admin can turn it on in <Link href="/settings/workspace">workspace settings</Link>.</Alert>
        ) : analyze.isPending ? (
          <Stages active />
        ) : latest ? (
          <AnalysisView a={latest} run={run} approvals={approvals} />
        ) : (
          <EmptyState compact icon={<Sparkles />} title="No analysis yet" description="Get a plain-language explanation of the failure, the evidence behind it and a recovery you can approve or reject."
            action={failed && <Button onClick={() => analyze.mutate()}><Sparkles aria-hidden /> Analyze failure</Button>} />
        )}
        {(analyses.length > 1 || approvals.length > (latest?.approvalRequestId ? 1 : 0)) && (
          <section aria-labelledby="ai-hist" className="border-t border-border pt-4">
            <h3 id="ai-hist" className="mb-2 flex items-center gap-2 text-base font-semibold"><History className="size-4" aria-hidden />Response history</h3>
            <ol className="flex flex-col gap-2">
              {[...analyses.slice(1).map((a) => ({ t: a.createdAt, k: a.id, text: `Analysis: ${a.summary} Recommended “${a.recommendation.title}”.` })),
                ...approvals.filter((x) => x.id !== latest?.approvalRequestId).map((x) => ({ t: x.decidedAt ?? x.requestedAt, k: x.id, text: `Approval ${x.id} ${x.status}${x.decidedByName ? ` by ${x.decidedByName}` : ""}${x.decisionReason ? `: “${x.decisionReason}”` : ""}.` }))]
                .sort((a, b) => b.t.localeCompare(a.t))
                .map((h) => <li key={h.k} className="flex gap-3 text-sm"><RelativeTime iso={h.t} className="w-28 shrink-0 text-fg-subtle" /><span>{h.text}</span></li>)}
            </ol>
          </section>
        )}
      </PanelBody>
    </Panel>
  );
}
