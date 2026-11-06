"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Alert, LoadingBlock } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage, mfaApi } from "@/lib/services";

/** Profile → Two-factor authentication: set up or turn off an authenticator app (TOTP). */
export function TwoFactorPanel() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["mfa-status"], queryFn: () => mfaApi.status() });
  const [setup, setSetup] = React.useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [codeErr, setCodeErr] = React.useState<string | null>(null);
  const [confirmOff, setConfirmOff] = React.useState(false);

  const start = useMutation({ mutationFn: () => mfaApi.enroll(), onSuccess: (s) => { setSetup(s); setCode(""); setCodeErr(null); }, onError: (e) => toast.error(errorMessage(e)) });
  const verify = useMutation({
    mutationFn: () => mfaApi.verify(setup!.factorId, code),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["mfa-status"] }); setSetup(null); toast.success("Two-factor authentication is on", { description: "You'll be asked for a code each time you sign in." }); },
    onError: (e) => setCodeErr(errorMessage(e)),
  });
  const off = useMutation({
    mutationFn: () => mfaApi.disable(status.data!.factorId!),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["mfa-status"] }); setConfirmOff(false); toast.success("Two-factor authentication is off"); },
    onError: (e) => { setConfirmOff(false); toast.error(errorMessage(e)); },
  });

  return (
    <Panel aria-labelledby="mfa-h">
      <PanelHeader id="mfa-h" title={<span className="inline-flex items-center gap-2">Two-factor authentication {status.data?.enabled && <Badge tone="success">On</Badge>}</span>}
        description="After your password (or Google/GitHub), also ask for a 6-digit code from an authenticator app on your phone." />
      <PanelBody className="flex flex-col gap-4">
        {status.isPending ? <LoadingBlock rows={1} label="Loading two-factor settings" /> : status.isError ? <Alert tone="danger">{errorMessage(status.error)}</Alert> : status.data.enabled ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-success" aria-hidden />Your account asks for a code at sign-in.</p>
            <Button variant="outline" onClick={() => setConfirmOff(true)}>Turn off</Button>
          </div>
        ) : setup ? (
          <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!/^\d{6}$/.test(code)) { setCodeErr("Enter the 6 digits from your app."); return; } verify.mutate(); }}>
            <ol className="ml-5 list-decimal space-y-1 text-sm">
              <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
              <li>Scan this QR code, or type the setup key.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-4">
              {/* QR code returned by Supabase as an SVG data URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="QR code for your authenticator app" width={176} height={176} className="rounded-md border border-border bg-white p-2" />
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="text-fg-muted">Setup key</span>
                <code className="break-all font-mono">{setup.secret}</code>
              </div>
            </div>
            <Field label="6-digit code" required error={codeErr}>
              {(p) => <Input {...p} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="w-40 font-mono tracking-[0.3em]" />}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" loading={verify.isPending}>Turn on</Button>
              <Button type="button" variant="ghost" onClick={() => setSetup(null)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">Recommended for owners and admins. If you lose your phone, an administrator has to remove it for you.</p>
            <Button onClick={() => start.mutate()} loading={start.isPending}>Set up</Button>
          </div>
        )}
      </PanelBody>
      <ConfirmDialog open={confirmOff} onOpenChange={setConfirmOff} destructive title="Turn off two-factor authentication?" confirmLabel="Turn off" loading={off.isPending} onConfirm={() => off.mutate()}
        description="Signing in will only need your password (or Google/GitHub) again." />
    </Panel>
  );
}
