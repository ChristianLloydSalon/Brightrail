"use client";

import { useMutation } from "@tanstack/react-query";
import { reloadTo } from "@/lib/navigation";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/feedback";
import { Field, FormErrorSummary } from "@/components/ui/field";
import { Input, PasswordInput } from "@/components/ui/input";
import { ApiError, authApi, errorMessage } from "@/lib/services";
import { hasErrors, validateEmail, validateNewPassword, type Errors } from "@/lib/validators";
import { SocialButtons, AuthHeading, PasswordChecklist } from "./shared";

type K = "name" | "email" | "password" | "confirm" | "terms";
const IDS: Record<K, string> = { name: "su-name", email: "su-email", password: "su-password", confirm: "su-confirm", terms: "su-terms" };

export function SignUpForm() {
  const [v, setV] = React.useState({ name: "", email: "", password: "", confirm: "", terms: false });
  const [errors, setErrors] = React.useState<Errors<K>>({});
  const [submitted, setSubmitted] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const validate = (x = v): Errors<K> => ({
    name: x.name.trim().length < 2 ? "Enter your full name." : null,
    email: validateEmail(x.email),
    password: validateNewPassword(x.password),
    confirm: !x.confirm ? "Confirm your password." : x.confirm !== x.password ? "Passwords don't match." : null,
    terms: x.terms ? null : "Accept the terms to continue.",
  });
  const set = <F extends keyof typeof v>(k: F, val: (typeof v)[F]) => {
    const next = { ...v, [k]: val };
    setV(next);
    if (submitted) setErrors(validate(next));
  };

  const m = useMutation({
    mutationFn: () => authApi.signUp({ name: v.name, email: v.email, password: v.password }),
    onSuccess: (r) => {
      if (r.needsConfirmation) return;
      toast.success("Account created");
      reloadTo("/onboarding");
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors) setErrors((p) => ({ ...p, ...e.fieldErrors }));
      else setFormError(errorMessage(e));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    const next = validate();
    setErrors(next);
    if (!hasErrors(next)) m.mutate();
  };
  const summary = submitted ? (Object.entries(errors) as Array<[K, string | null]>).filter(([, msg]) => msg).map(([k, msg]) => ({ id: IDS[k], message: msg! })) : [];

  if (m.data?.needsConfirmation)
    return (
      <div role="status">
        <div className="mb-4 flex size-11 items-center justify-center rounded-lg border border-success-border bg-success-soft text-success-fg"><MailCheck className="size-5" aria-hidden /></div>
        <AuthHeading title="Check your email" description={<>We sent a confirmation link to <strong>{v.email}</strong>. Open it on this device to finish creating your account. It can take a minute to arrive; check spam if you don't see it.</>} />
        <Button asChild variant="outline" className="w-full"><Link href="/sign-in">Back to sign in</Link></Button>
      </div>
    );

  return (
    <>
      <AuthHeading title="Create your account" description="Start with a free workspace. You can invite your team afterwards." />
      <SocialButtons next="/onboarding" />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <FormErrorSummary errors={summary} />
        {formError && <Alert tone="danger" role="alert">{formError}</Alert>}
        <Field id={IDS.name} label="Full name" required error={errors.name}>
          {(p) => <Input {...p} autoComplete="name" value={v.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field id={IDS.email} label="Work email" required error={errors.email}>
          {(p) => <Input {...p} type="email" inputMode="email" autoComplete="email" value={v.email} onChange={(e) => set("email", e.target.value)} />}
        </Field>
        <Field id={IDS.password} label="Password" required error={errors.password}>
          {(p) => (
            <>
              <PasswordInput {...p} autoComplete="new-password" value={v.password} onChange={(e) => set("password", e.target.value)} aria-describedby={[p["aria-describedby"], "su-rules"].filter(Boolean).join(" ")} />
              <PasswordChecklist value={v.password} id="su-rules" />
            </>
          )}
        </Field>
        <Field id={IDS.confirm} label="Confirm password" required error={errors.confirm}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" value={v.confirm} onChange={(e) => set("confirm", e.target.value)} />}
        </Field>
        <div>
          <CheckboxField
            id={IDS.terms}
            checked={v.terms}
            onCheckedChange={(c) => set("terms", c)}
            label={<>I agree to the Terms of Service and the Data Processing Addendum.</>}
          />
          {errors.terms && <p className="mt-1 text-sm text-danger-fg dark:text-danger" id={`${IDS.terms}-err`}>{errors.terms}</p>}
        </div>
        <Button type="submit" size="lg" loading={m.isPending} loadingText="Creating account…" className="w-full">
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-base text-fg-muted">
        Already have an account? <Link href="/sign-in" className="font-medium text-link hover:underline">Sign in</Link>
      </p>
    </>
  );
}
