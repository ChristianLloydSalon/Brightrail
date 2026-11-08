"use client";

import { useMutation } from "@tanstack/react-query";
import { reloadTo, safeLocalPath } from "@/lib/navigation";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authApi, errorMessage, mfaApi } from "@/lib/services";
import { AuthHeading } from "./shared";

/** Second sign-in step for people who set up an authenticator app. */
export function MfaForm() {
  const params = useSearchParams();
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<HTMLInputElement>(null);
  const next = params.get("next");
  const safeNext = safeLocalPath(next);

  const verify = useMutation({
    mutationFn: () => mfaApi.verifySignIn(code),
    onSuccess: () => { reloadTo(safeNext); },
    onError: (e) => { setError(errorMessage(e)); setCode(""); ref.current?.focus(); },
  });
  const signOut = useMutation({ mutationFn: () => authApi.signOut(), onSuccess: () => { reloadTo("/sign-in"); } });

  return (
    <>
      <AuthHeading title="Enter your code" description="Open your authenticator app (Google Authenticator, 1Password, Authy…) and enter the 6-digit code for Brightrail." />
      <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!/^\d{6}$/.test(code)) { setError("Enter the 6 digits from your app."); ref.current?.focus(); return; } setError(null); verify.mutate(); }}>
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        <Field label="6-digit code" required>
          {(p) => <Input {...p} ref={ref} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus className="font-mono text-lg tracking-[0.3em]" placeholder="123456" />}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={verify.isPending} loadingText="Checking…">Continue</Button>
      </form>
      <div className="mt-6 flex flex-col gap-2 text-sm text-fg-muted">
        <p>Lost access to your authenticator? An administrator of this Brightrail installation can remove it for you in Supabase (Authentication → Users → your account → MFA).</p>
        <button type="button" className="w-fit text-link underline" onClick={() => signOut.mutate()}>Sign out</button>
      </div>
    </>
  );
}
