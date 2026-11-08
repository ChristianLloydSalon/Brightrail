"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, MailCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authApi, errorMessage } from "@/lib/services";
import { validateEmail } from "@/lib/validators";
import { AuthHeading } from "./shared";

export function ForgotPasswordForm() {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const m = useMutation({ mutationFn: () => authApi.requestPasswordReset(email) });
  const headingRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (m.isSuccess) headingRef.current?.focus();
  }, [m.isSuccess]);

  if (m.isSuccess)
    return (
      <div ref={headingRef} tabIndex={-1} className="outline-none" role="status">
        <div className="mb-4 flex size-11 items-center justify-center rounded-lg border border-success-border bg-success-soft text-success-fg">
          <MailCheck className="size-5" aria-hidden />
        </div>
        <AuthHeading title="Check your email" description={<>If an account exists for <strong>{email}</strong>, we've sent a link to reset your password. Open it on this device. The link expires after one hour.</>} />
        <Button variant="outline" className="w-full" onClick={() => m.reset()}>Use a different email</Button>
        <p className="mt-6 text-center"><Link href="/sign-in" className="inline-flex items-center gap-1 text-base text-link hover:underline"><ArrowLeft className="size-4" aria-hidden /> Back to sign in</Link></p>
      </div>
    );

  return (
    <>
      <AuthHeading title="Reset your password" description="Enter the email you sign in with and we'll send you a reset link." />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const err = validateEmail(email);
          setError(err);
          if (!err) m.mutate();
        }}
      >
        {m.isError && <Alert tone="danger" role="alert">{errorMessage(m.error)}</Alert>}
        <Field label="Email" required error={error}>
          {(p) => <Input {...p} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
        </Field>
        <Button type="submit" size="lg" loading={m.isPending} loadingText="Sending link…" className="w-full">Send reset link</Button>
      </form>
      <p className="mt-6 text-center"><Link href="/sign-in" className="inline-flex items-center gap-1 text-base text-link hover:underline"><ArrowLeft className="size-4" aria-hidden /> Back to sign in</Link></p>
    </>
  );
}
