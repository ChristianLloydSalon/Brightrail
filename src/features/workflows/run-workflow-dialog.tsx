"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useOnChange } from "@/hooks/use-on-change";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { errorMessage, workflowsApi } from "@/lib/services";

/** Manual trigger with an editable JSON payload (POST /workflows/:id/runs). */
export function RunWorkflowDialog({ open, onOpenChange, workflowId: fixedId }: { open: boolean; onOpenChange: (o: boolean) => void; workflowId?: string }) {
  const router = useRouter();
  const [workflowId, setWorkflowId] = React.useState<string | undefined>(fixedId);
  const [payload, setPayload] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [wfError, setWfError] = React.useState<string | null>(null);
  const list = useQuery({ queryKey: ["workflows", "active-for-run"], queryFn: () => workflowsApi.list({ status: "active", pageSize: 100, sort: "name", dir: "asc" }), enabled: open && !fixedId });
  const sample = useQuery({ queryKey: ["workflow-sample", workflowId], queryFn: () => workflowsApi.sampleInput(workflowId!), enabled: open && !!workflowId });

  useOnChange(open, (o) => {
    if (o) setWorkflowId(fixedId);
    else { setPayload(""); setError(null); setWfError(null); }
  });
  useOnChange(fixedId, (id) => { if (open) setWorkflowId(id); });
  useOnChange(sample.data, (d) => { if (d) setPayload(JSON.stringify(d, null, 2)); });

  const m = useMutation({
    mutationFn: (input: Record<string, unknown>) => workflowsApi.runNow(workflowId!, input),
    onSuccess: (run) => {
      toast.success("Run started", { description: `${run.workflowName} · ${run.id}` });
      onOpenChange(false);
      router.push(`/executions/${run.id}`);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflowId) return setWfError("Choose a workflow to run.");
    let parsed: unknown;
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {};
    } catch (err) {
      return setError(`Payload isn't valid JSON: ${(err as Error).message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return setError("Payload must be a JSON object.");
    setError(null);
    m.mutate(parsed as Record<string, unknown>);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader title="Run workflow" description="Starts a run of the current published version. The run is pinned to that version even if you publish again." />
        <form onSubmit={submit} noValidate>
          <DialogBody className="flex flex-col gap-4">
            {m.isError && <Alert tone="danger" role="alert">{errorMessage(m.error)}</Alert>}
            {!fixedId && (
              <Field label="Workflow" required error={wfError}>
                {(p) => (
                  <Select
                    {...p}
                    value={workflowId}
                    onValueChange={(v) => { setWorkflowId(v); setWfError(null); }}
                    loading={list.isPending}
                    error={list.isError ? "Couldn't load workflows" : null}
                    emptyMessage="No active workflows. Publish one first."
                    placeholder="Choose an active workflow"
                    options={(list.data?.items ?? []).map((w) => ({ value: w.id, label: w.name, description: `v${w.currentVersion} · ${w.triggerType === "webhook" ? "Webhook trigger" : w.triggerType === "schedule" ? "Schedule trigger" : "Manual trigger"}` }))}
                  />
                )}
              </Field>
            )}
            <Field label="Input payload (JSON)" error={error} description="Sensitive fields are redacted before the run is stored.">
              {(p) => <Textarea {...p} value={payload} onChange={(e) => setPayload(e.target.value)} rows={9} className="font-mono text-sm" spellCheck={false} disabled={!workflowId || sample.isPending} />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" loading={m.isPending} loadingText="Starting…">Start run</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
