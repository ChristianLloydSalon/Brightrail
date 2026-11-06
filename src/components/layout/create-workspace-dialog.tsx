"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError, authApi, errorMessage } from "@/lib/services";
import { slugify } from "@/lib/utils";

export function CreateWorkspaceForm({ onCreated, footer }: { onCreated: () => void; footer: (pending: boolean) => React.ReactNode }) {
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => authApi.createWorkspace(name, Intl.DateTimeFormat().resolvedOptions().timeZone),
    onSuccess: async (ws) => {
      await qc.invalidateQueries();
      toast.success(`Workspace “${ws.name}” created`, { description: "You're the owner. Invite your team from Members." });
      onCreated();
    },
    onError: (e) => setError(e instanceof ApiError && e.fieldErrors?.name ? e.fieldErrors.name : errorMessage(e)),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim().length < 2) return setError("Use at least 2 characters.");
        setError(null);
        m.mutate();
      }}
    >
      <DialogBody className="flex flex-col gap-4">
        <Field label="Workspace name" required error={error} description={name.trim() ? `URL: flowforge.app/${slugify(name) || "workspace"}` : "Usually your company or team name."}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" placeholder="Acme Operations" autoFocus />}
        </Field>
        <p className="text-sm text-fg-muted">Each workspace is isolated: workflows, runs, connections and members are never shared across workspaces.</p>
      </DialogBody>
      {footer(m.isPending)}
    </form>
  );
}

export function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader title="Create workspace" description="A separate tenant with its own members, workflows and credentials." />
        <CreateWorkspaceForm
          onCreated={() => {
            onOpenChange(false);
            router.push("/dashboard");
          }}
          footer={(pending) => (
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" loading={pending}>Create workspace</Button>
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}
