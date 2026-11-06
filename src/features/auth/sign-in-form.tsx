"use client";

import { useMutation } from "@tanstack/react-query";
import { reloadTo } from "@/lib/navigation";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, PasswordInput } from "@/components/ui/input";
import { authApi, errorMessage } from "@/lib/services";
import { hasErrors, validateEmail, type Errors } from "@/lib/validators";
import { AuthHeading, SocialButtons } from "./shared";

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [errors, setErrors] = React.useState<Errors<"email" | "password">>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  const m = useMutation({
    mutationFn: () => authApi.signIn(email, password),
    onSuccess: (res) => {
      const next = params.get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      // Full navigation so the server sees the fresh session cookie.
      if (res.needsCode) {
        reloadTo(`/mfa?next=${encodeURIComponent(safeNext)}`);
        return;
      }
      toast.success(`Welcome back${res.user.name ? `, ${res.user.name.split(" ")[0]}` : ""}`);
      reloadTo(res.workspaces.length ? safeNext : "/onboarding");
    },
    onError: (e) => {
      setFormError(errorMessage(e));
      passwordRef.current?.focus();
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = { email: validateEmail(email), password: password ? null : "Enter your password." };
    setErrors(next);
    setFormError(null);
    if (hasErrors(next)) {
      (next.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    m.mutate();
  };

  return (
    <>
      <AuthHeading title="Sign in to FlowForge" description="Use your work email to access your workspaces." />
      <SocialButtons next={params.get("next") ?? "/dashboard"} />
      {params.get("deleted") === "1" && <Alert tone="success" className="mb-5" role="status" title="Your account was deleted">Thanks for using FlowForge.</Alert>}
      {params.get("error") === "oauth" && (
        <Alert tone="warning" className="mb-5" role="alert" title="That sign-in didn't finish">It was cancelled or the provider refused it. Try again, or use your email and password.</Alert>
      )}
      {params.get("error") === "link" && (
        <Alert tone="warning" className="mb-5" role="alert" title="That link didn't work">It may have expired or already been used. Sign in, or request a new password-reset email.</Alert>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-describedby={formError ? "signin-error" : undefined}>
        {formError && (
          <div id="signin-error">
            <Alert tone="danger" role="alert">{formError}</Alert>
          </div>
        )}
        <Field label="Email" required error={errors.email}>
          {(p) => <Input {...p} ref={emailRef} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Field
          label="Password"
          required
          error={errors.password}
          labelAction={<Link href="/forgot-password" className="text-sm text-link hover:underline">Forgot password?</Link>}
        >
          {(p) => <PasswordInput {...p} ref={passwordRef} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" size="lg" loading={m.isPending} loadingText="Signing in…" className="mt-1 w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-base text-fg-muted">
        New to FlowForge?{" "}
        <Link href="/sign-up" className="font-medium text-link hover:underline">Create an account</Link>
      </p>
    </>
  );
}
