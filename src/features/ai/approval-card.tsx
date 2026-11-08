"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOnChange } from "@/hooks/use-on-change";
import { Check, Clock, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { useAnnounce } from "@/components/providers/announcer";
import { RelativeTime } from "@/components/shared/time";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { useCurrent } from "@/hooks/use-current";
import { APPROVAL_STATUS_META } from "@/lib/domain/status";
import type { ApprovalRequest } from "@/lib/domain/types";
import { aiApi, ApiError, errorMessage } from "@/lib/services";

export function DecisionDialog({ approval, decision, onOpenChange }: { approval: ApprovalRequest; decision: "approve" | "reject" | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const announce = useAnnounce();
  const [reason, setReason] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  useOnChange(decision, (d) => { if (!d) { setReason(""); setErr(null); } });
  const m = useMutation({
    mutationFn: () => aiApi.decide(approval.id, decision!, reason),
    onSuccess: async (a) => {
      await qc.invalidateQueries();
      onOpenChange(false);
      const msg = a.status === "approved" ? "Approved. The retry was dispatched; watch the run status update." : "Rejected. The run stays failed and the requester can see your reason.";
      toast.success(a.status === "approved" ? "Recovery approved" : "Recovery rejected", { description: msg });
      announce(msg);
    },
    onError: (e) => setErr(e instanceof ApiError && e.fieldErrors?.reason ? e.fieldErrors.reason : errorMessage(e)),
  });
  return (
    <Dialog open={!!decision} onOpenChange={(o) => !m.isPending && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader title={decision === "approve" ? "Approve recovery action" : "Reject recovery action"} description={`${approval.workflowName} · ${approval.runId}`} />
        <form noValidate onSubmit={(e) => { e.preventDefault(); if (decision === "reject" && reason.trim().length < 3) return setErr("Add a short reason so the requester knows what to do next."); setErr(null); m.mutate(); }}>
          <DialogBody className="flex flex-col gap-4">
            <CodeBlock label="Action to dispatch" code={JSON.stringify(approval.toolCall, null, 2)} />
            {decision === "approve" && <Alert tone="info">Your permissions and the run's current state are re-checked at dispatch. The action runs once, through a restricted worker activity, and is recorded in the audit log under your name.</Alert>}
            <Field label={decision === "approve" ? "Note" : "Reason for rejecting"} required={decision === "reject"} optional={decision === "approve"} error={err}>
              {(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={decision === "approve" ? "e.g. Provider status page shows the incident is resolved" : "e.g. Rotate the credential first"} />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" variant={decision === "reject" ? "destructive" : "primary"} loading={m.isPending}>{decision === "approve" ? <><Check aria-hidden /> Approve and dispatch</> : <><X aria-hidden /> Reject</>}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A single approval request with its decision controls (or the reason they're unavailable). */
export function ApprovalCard({ approval, showRunLink }: { approval: ApprovalRequest; showRunLink?: boolean }) {
  const { can } = useCurrent();
  const [decision, setDecision] = React.useState<"approve" | "reject" | null>(null);
  const canDecide = can("approvals.decide");
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium">{showRunLink ? <Link href={`/executions/${approval.runId}#ai`} className="hover:underline">{approval.workflowName}</Link> : "Approval request"} <span className="font-mono text-xs text-fg-subtle">{approval.id}</span></p>
          <p className="text-sm text-fg-muted">Requested by {approval.requestedBy.name} · <RelativeTime iso={approval.requestedAt} /></p>
        </div>
        <StatusBadge meta={APPROVAL_STATUS_META[approval.status]} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">AI-written summary</p>
        <p className="text-base">{approval.rationale}</p>
        <p className="text-sm text-fg-muted">Written by the assistant from the run's error details, which can include text from outside services. Check the run log before approving.</p>
      </div>
      <CodeBlock code={`${approval.toolCall.name}(${Object.entries(approval.toolCall.args).map(([k, v]) => `${k}="${v}"`).join(", ")})`} />
      {approval.status === "pending" ? (
        <>
          <p className="flex items-center gap-1.5 text-sm text-fg-muted"><Clock className="size-4" aria-hidden />Expires <RelativeTime iso={approval.expiresAt} /></p>
          {canDecide ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDecision("approve")}><Check aria-hidden /> Approve</Button>
              <Button variant="destructive-outline" onClick={() => setDecision("reject")}><X aria-hidden /> Reject</Button>
            </div>
          ) : <Alert tone="info">Your role can't decide approvals. An owner, admin or authorized operator must approve this.</Alert>}
        </>
      ) : (
        <p className="text-sm text-fg-muted">
          {approval.status === "expired" ? "Expired without a decision." : <>{APPROVAL_STATUS_META[approval.status].label} by {approval.decidedByName} <RelativeTime iso={approval.decidedAt} />{approval.decisionReason && <>: “{approval.decisionReason}”</>}</>}
          {approval.outcome === "resolved" && " · Outcome: run recovered."}
          {approval.outcome === "pending" && " · Outcome: retry in progress."}
          {approval.outcome === "still_failing" && " · Outcome: the step failed again."}
        </p>
      )}
      <DecisionDialog approval={approval} decision={decision} onOpenChange={(o) => !o && setDecision(null)} />
    </div>
  );
}
