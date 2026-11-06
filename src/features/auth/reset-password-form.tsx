"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { reloadTo } from "@/lib/navigation";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert, LoadingBlock } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/input";
import { authApi, errorMessage } from "@/lib/services";
import { hasErrors, validateNewPassword, type Errors } from "@/lib/validators";
import { AuthHeading, PasswordChecklist } from "./shared";

/** Reached from the recovery or invitation email (the callback route has already signed the user in). */
export function ResetPasswordForm() {
  const invited = useSearchParams().get("invited") === "1";
  const session = useQuery({ queryKey: ["recovery-session"], queryFn: () => authApi.hasRecoverySession(), retry: false });
  const [pw, setPw] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [errors, setErrors] = React.useState<Errors<"pw" | "confirm">>({});
  const m = useMutation({
    mutationFn: () => authApi.resetPassword(pw),
    onSuccess: () => {
      toast.success(invited ? "Password created" : "Password updated");
      reloadTo(invited ? "/onboarding" : "/dashboard");
    },
  });

  if (session.isPending) return <LoadingBlock rows={3} label="Checking your link" />;
  if (session.isError || !session.data?.email)
    return (
      <>
        <AuthHeading title="This link can't be used" />
        <Alert tone="danger" role="alert" className="mb-4">{session.isError ? errorMessage(session.error) : "The link has expired or was already used. Request a new one."}</Alert>
        <Button asChild className="w-full"><Link href="/forgot-password">Request a new link</Link></Button>
      </>
    );

  return (
    <>
      <AuthHeading title={invited ? "Create your password" : "Choose a new password"} description={<>{invited ? "You've been invited to FlowForge. Set a password for " : "For "}<strong>{session.data.email}</strong></>} />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const next = { pw: validateNewPassword(pw), confirm: !confirm ? "Confirm your password." : confirm !== pw ? "Passwords don't match." : null };
          setErrors(next);
          if (!hasErrors(next)) m.mutate();
        }}
      >
        {m.isError && <Alert tone="danger" role="alert">{errorMessage(m.error)}</Alert>}
        <Field label={invited ? "Password" : "New password"} required error={errors.pw}>
          {(p) => (
            <>
              <PasswordInput {...p} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby={[p["aria-describedby"], "rp-rules"].filter(Boolean).join(" ")} />
              <PasswordChecklist value={pw} id="rp-rules" />
            </>
          )}
        </Field>
        <Field label="Confirm password" required error={errors.confirm}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" loading={m.isPending} loadingText="Saving…" className="w-full">{invited ? "Create password and continue" : "Update password"}</Button>
      </form>
    </>
  );
}
