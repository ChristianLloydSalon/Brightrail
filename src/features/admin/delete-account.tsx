"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { reloadTo } from "@/lib/navigation";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Alert, LoadingBlock } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError, authApi, errorMessage } from "@/lib/services";

/** Profile → Delete account. Explains exactly what happens first, then asks for the email address. */
export function DeleteAccountPanel() {
  const [open, setOpen] = React.useState(false);
  const [confirm, setConfirm] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const check = useQuery({ queryKey: ["account-deletion"], queryFn: () => authApi.accountDeletionCheck(), enabled: open });
  const del = useMutation({
    mutationFn: () => authApi.deleteAccount(confirm),
    onSuccess: async () => {
      await authApi.signOut().catch(() => undefined);
      reloadTo("/sign-in?deleted=1");
    },
    onError: (e) => setErr(e instanceof ApiError && e.fieldErrors?.confirm ? e.fieldErrors.confirm : errorMessage(e)),
  });
  const blocked = !!check.data?.blocking.length;

  return (
    <Panel aria-labelledby="del-h">
      <PanelHeader id="del-h" title="Delete account" description="Permanently delete your Brightrail account and sign out everywhere." />
      <PanelBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">This can't be undone.</p>
        <Button variant="destructive" onClick={() => { setOpen(true); setConfirm(""); setErr(null); }}>Delete my account…</Button>
      </PanelBody>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader title="Delete your account?" description="Your login, profile and notification settings are deleted permanently." />
          <form noValidate onSubmit={(e) => { e.preventDefault(); if (!confirm.trim()) { setErr("Type your email address to confirm."); return; } del.mutate(); }}>
            <DialogBody className="flex flex-col gap-4">
              {check.isPending ? <LoadingBlock rows={2} label="Checking your workspaces" /> : check.isError ? <Alert tone="danger">{errorMessage(check.error)}</Alert> : (
                <>
                  {blocked && (
                    <Alert tone="warning" title="Transfer ownership first">
                      You own {check.data.blocking.map((w) => `“${w.name}”`).join(", ")}, which {check.data.blocking.length === 1 ? "has" : "have"} other members. In <Link href="/settings/members">Settings → Members</Link>, choose <strong>Make owner…</strong> for someone else (or remove the other members), then come back.
                    </Alert>
                  )}
                  <ul className="ml-5 list-disc space-y-1 text-sm">
                    {check.data.deleting.length > 0 && <li><strong>Deleted with your account:</strong> {check.data.deleting.map((w) => `“${w.name}”`).join(", ")} — you're the only member, so all {check.data.deleting.length === 1 ? "its" : "their"} workflows, runs and connections go too.</li>}
                    <li>In other workspaces, workflows you own move to the workspace owner, and API keys you created stop working.</li>
                    <li>The audit log keeps a record that your account was deleted.</li>
                  </ul>
                  {!blocked && (
                    <Field label={<>Type <strong>{check.data.email}</strong> to confirm</>} required error={err}>
                      {(p) => <Input {...p} type="email" autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
                    </Field>
                  )}
                </>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button type="submit" variant="destructive" disabled={!check.data || blocked} loading={del.isPending}>Delete account</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
