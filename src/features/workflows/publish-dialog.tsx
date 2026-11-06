"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOnChange } from "@/hooks/use-on-change";
import { AlertCircle, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useAnnounce } from "@/components/providers/announcer";
import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/card";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Alert, LoadingBlock } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import type { WorkflowVersion } from "@/lib/domain/types";
import { errorMessage, workflowsApi } from "@/lib/services";

/**
 * BUILDER-04 publishing confirmation. Re-validates on the server, blocks on errors, and explains
 * that the published version is immutable.
 */
export function PublishDialog({ open, onOpenChange, workflowId, revision, nextVersion, onFixIssue, onPublished }: {
  open: boolean; onOpenChange: (o: boolean) => void; workflowId: string; revision: number; nextVersion: number;
  onFixIssue?: (nodeId: string) => void; onPublished?: (v: WorkflowVersion) => void;
}) {
  const qc = useQueryClient();
  const announce = useAnnounce();
  const [note, setNote] = React.useState("");
  const [noteErr, setNoteErr] = React.useState<string | null>(null);
  const v = useQuery({ queryKey: ["publish-validate", workflowId, revision], queryFn: () => workflowsApi.validate(workflowId), enabled: open, staleTime: 0, gcTime: 0 });
  useOnChange(open, (o) => { if (!o) { setNote(""); setNoteErr(null); } });
  React.useEffect(() => {
    if (v.data) announce(v.data.valid ? `Validation passed with ${v.data.warnings.length} warnings. Ready to publish.` : `Validation found ${v.data.errors.length} errors. Publishing is blocked.`);
  }, [v.data, announce]);
  const m = useMutation({
    mutationFn: () => workflowsApi.publish(workflowId, note, revision),
    onSuccess: async (ver) => {
      await qc.invalidateQueries();
      toast.success(`Version ${ver.version} published`, { description: "New triggers will use this version. In-flight runs keep their pinned version." });
      announce(`Version ${ver.version} published.`);
      onOpenChange(false);
      onPublished?.(ver);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !m.isPending && onOpenChange(o)}>
      <DialogContent size="lg">
        <DialogHeader title={`Publish version ${nextVersion}`} description="Publishing creates an immutable snapshot of the saved draft. To change it later, edit the draft and publish a new version." />
        <form noValidate onSubmit={(e) => { e.preventDefault(); if (note.trim().length < 5) return setNoteErr("Describe the change in at least 5 characters."); setNoteErr(null); m.mutate(); }}>
          <DialogBody className="flex flex-col gap-4">
            {v.isPending ? <LoadingBlock rows={3} label="Validating the saved draft" /> : v.isError ? (
              <Alert tone="danger" role="alert" title="Validation couldn't run" action={<Button size="sm" variant="outline" onClick={() => void v.refetch()}>Try again</Button>}>{errorMessage(v.error)}</Alert>
            ) : v.data && (
              <>
                {v.data.valid ? (
                  <Alert tone="success" title="Validation passed">The graph compiles and every step is configured.{v.data.warnings.length ? ` ${v.data.warnings.length} warning${v.data.warnings.length === 1 ? "" : "s"} to review.` : ""}</Alert>
                ) : (
                  <Alert tone="danger" role="alert" title={`${v.data.errors.length} error${v.data.errors.length === 1 ? "" : "s"} must be fixed before publishing`} />
                )}
                {v.data.issues.length > 0 && (
                  <ul className="flex max-h-56 flex-col divide-y divide-border overflow-auto rounded-md border border-border" aria-label="Validation results">
                    {v.data.issues.map((i) => (
                      <li key={i.id} className="flex items-start gap-2 px-3 py-2 text-base">
                        {i.severity === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />}
                        <span className="flex-1"><span className="sr-only">{i.severity}: </span>{i.message}</span>
                        {i.nodeId && onFixIssue && <Button size="sm" variant="ghost" onClick={() => { onOpenChange(false); onFixIssue(i.nodeId!); }}>Fix<span className="sr-only"> {i.message}</span></Button>}
                      </li>
                    ))}
                  </ul>
                )}
                {v.data.valid && (
                  <>
                    <Field label="Change note" required error={noteErr} description="Shown in version history and the audit log.">
                      {(p) => <Textarea {...p} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Raised invoice timeout to 20s" />}
                    </Field>
                    <div className="flex items-start gap-2 rounded-md bg-surface-sunken p-3 text-sm text-fg-muted">
                      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <p>Version {nextVersion} will be pinned by every new run. Its checksum is recorded and the definition can't be edited in place. Draft revision <Mono>r{revision}</Mono>.</p>
                    </div>
                  </>
                )}
              </>
            )}
            {m.isError && <Alert tone="danger" role="alert">{errorMessage(m.error)}</Alert>}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" disabled={m.isPending}>Cancel</Button></DialogClose>
            <Button type="submit" disabled={!v.data?.valid} loading={m.isPending} loadingText="Publishing…"><CheckCircle2 aria-hidden /> Publish version {nextVersion}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
