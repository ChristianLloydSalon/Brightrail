"use client";

import { useMutation } from "@tanstack/react-query";
import { useOnChange } from "@/hooks/use-on-change";
import { MousePointerClick, Timer, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RadioCard, RadioGroup } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, Fieldset } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { ApiError, errorMessage, workflowsApi } from "@/lib/services";

/** FLOW-02 steps 2–4: enter workflow information, then open the visual editor. */
export function CreateWorkflowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [v, setV] = React.useState({ name: "", description: "", trigger: "webhook" as "manual" | "webhook" | "schedule", tags: "" });
  const [errors, setErrors] = React.useState<{ name?: string | null }>({});
  const m = useMutation({
    mutationFn: () => workflowsApi.create({ name: v.name, description: v.description, triggerType: v.trigger, tags: v.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) }),
    onSuccess: (wf) => {
      toast.success("Workflow created", { description: "Add steps in the editor, then validate and publish." });
      onOpenChange(false);
      router.push(`/workflows/${wf.id}/edit`);
    },
    onError: (e) => { if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors); },
  });
  useOnChange(open, (o) => { if (!o) { setV({ name: "", description: "", trigger: "webhook", tags: "" }); setErrors({}); } });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) m.reset(); onOpenChange(o); }}>
      <DialogContent size="md">
        <DialogHeader title="Create workflow" description="Name it and choose how it starts. You'll add steps in the visual editor next." />
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const nameErr = v.name.trim().length < 3 ? "Use at least 3 characters." : v.name.length > 80 ? "Use 80 characters or fewer." : null;
            setErrors({ name: nameErr });
            if (!nameErr) m.mutate();
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            {m.isError && !(m.error instanceof ApiError && m.error.fieldErrors) && <Alert tone="danger" role="alert">{errorMessage(m.error)}</Alert>}
            <Field label="Name" required error={errors.name}>
              {(p) => <Input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Order fulfilment" maxLength={90} autoFocus />}
            </Field>
            <Field label="Description" optional>
              {(p) => <Textarea {...p} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} rows={2} placeholder="What does this workflow do, and who relies on it?" />}
            </Field>
            <Fieldset legend="Trigger">
              <RadioGroup value={v.trigger} onValueChange={(t) => setV({ ...v, trigger: t as "manual" | "webhook" | "schedule" })}>
                <RadioCard id="trg-webhook" value="webhook" icon={<Webhook className="size-4" />} label="Signed webhook" description="Starts when another system sends an event." />
                <RadioCard id="trg-manual" value="manual" icon={<MousePointerClick className="size-4" />} label="Manual" description="Starts when you click Run, or from the API." />
                <RadioCard id="trg-schedule" value="schedule" icon={<Timer className="size-4" />} label="Schedule" description="Runs automatically: every hour, daily, weekly…" />
              </RadioGroup>
            </Fieldset>
            <Field label="Tags" optional description="Comma-separated, for example: orders, payments">
              {(p) => <Input {...p} value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" loading={m.isPending} loadingText="Creating…">Create and open editor</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
