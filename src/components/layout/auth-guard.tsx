"use client";

import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { LogoMark } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/feedback";
import { useCurrent } from "@/hooks/use-current";
import { ApiError } from "@/lib/api-error";

/**
 * Client guard for app routes. The proxy already redirects signed-out visitors; this handles
 * users without a workspace and surfaces configuration problems clearly.
 */
export function AuthGuard({ children, requireWorkspace = true }: { children: React.ReactNode; requireWorkspace?: boolean }) {
  const { loading, error, user, workspace } = useCurrent();
  const router = useRouter();
  const pathname = usePathname();
  const unauth = error instanceof ApiError && error.code === "UNAUTHENTICATED";
  const needsWorkspace = !loading && !!user && requireWorkspace && !workspace;
  React.useEffect(() => {
    if (unauth) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    else if (needsWorkspace) router.replace("/onboarding");
  }, [unauth, needsWorkspace, router, pathname]);

  if (error && !unauth)
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <ErrorState title="FlowForge couldn't start" error={error} onRetry={() => window.location.reload()} />
        {error instanceof ApiError && error.code === "NOT_CONFIGURED" && <Button asChild variant="link"><a href="/setup">Open setup check</a></Button>}
      </div>
    );
  if (loading || unauth || needsWorkspace)
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Loading FlowForge">
        <LogoMark className="size-9 animate-pulse motion-reduce:animate-none" />
      </div>
    );
  return <>{children}</>;
}
