"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { safeLocalPath } from "@/lib/navigation";
import { authApi, errorMessage } from "@/lib/services";
import { PASSWORD_RULES, passwordStrength } from "@/lib/validators";
import { cn } from "@/lib/utils";

/**
 * "Continue with Google / GitHub", shown only for providers switched on in Supabase
 * (Authentication → Sign In / Providers). Hidden entirely when none are.
 */
export function SocialButtons({ next = "/dashboard" }: { next?: string }) {
  const q = useQuery({ queryKey: ["auth-options"], queryFn: () => authApi.options(), staleTime: 60_000, retry: false });
  const go = useMutation({ mutationFn: (p: "google" | "github") => authApi.signInWithProvider(p, safeLocalPath(next)) });
  const providers = (["google", "github"] as const).filter((p) => q.data?.[p]);
  if (!providers.length) return null;
  return (
    <div className="mb-5 flex flex-col gap-3">
      {go.isError && <Alert tone="danger" role="alert">{errorMessage(go.error)}</Alert>}
      {providers.map((p) => (
        <Button key={p} type="button" variant="outline" size="lg" className="w-full" loading={go.isPending && go.variables === p} loadingText="Redirecting…" onClick={() => go.mutate(p)}>
          Continue with {p === "google" ? "Google" : "GitHub"}
        </Button>
      ))}
      <p className="text-sm text-fg-muted">
        By continuing, you agree to the <Link href="/terms" target="_blank" className="font-medium text-link hover:underline">Terms of Service</Link> and
        acknowledge the <Link href="/privacy" target="_blank" className="font-medium text-link hover:underline">Privacy Policy</Link>.
      </p>
      <div className="flex items-center gap-3 text-sm text-fg-muted" role="separator" aria-label="or use email">
        <span className="h-px flex-1 bg-border" aria-hidden />or<span className="h-px flex-1 bg-border" aria-hidden />
      </div>
    </div>
  );
}

export function AuthHeading({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-1.5">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <p className="text-base text-fg-muted">{description}</p>}
    </div>
  );
}

/** Live password requirements. Each rule shows an icon and text, so meeting it isn't signalled by color alone. */
export function PasswordChecklist({ value, id }: { value: string; id: string }) {
  const strength = passwordStrength(value);
  return (
    <div id={id} className="flex flex-col gap-2">
      <div className="flex items-center gap-2" aria-hidden={!value}>
        <div className="flex flex-1 gap-1">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={cn("h-1 flex-1 rounded-full bg-border", value && strength.score >= i && (strength.score <= 1 ? "bg-danger" : strength.score === 2 ? "bg-warning" : "bg-success"))} />
          ))}
        </div>
        <span className="w-16 text-right text-sm text-fg-muted">{value ? strength.label : ""}</span>
      </div>
      <ul className="flex flex-col gap-1 text-sm" aria-label="Password requirements">
        {PASSWORD_RULES.map((r) => {
          const ok = r.test(value);
          return (
            <li key={r.id} className={cn("flex items-center gap-1.5", ok ? "text-success-fg dark:text-success" : "text-fg-muted")}>
              {ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
              {r.label}
              <span className="sr-only">{ok ? ": met" : ": not met"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
