import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-sm bg-[color-mix(in_oklab,var(--border),transparent_30%)] motion-reduce:animate-none", className)} aria-hidden {...props} />;
}

export function Spinner({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-sm text-fg-muted", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

/** Loading placeholder for a page region, announced once to screen readers. */
export function LoadingBlock({ rows = 4, label = "Loading", className }: { rows?: number; label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10" style={{ opacity: 1 - i * 0.12 }} />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

type AlertTone = "info" | "success" | "warning" | "danger";
const alertTones: Record<AlertTone, { cls: string; Icon: React.ComponentType<{ className?: string }> }> = {
  info: { cls: "border-info-border bg-info-soft text-info-fg", Icon: Info },
  success: { cls: "border-success-border bg-success-soft text-success-fg", Icon: CheckCircle2 },
  warning: { cls: "border-warning-border bg-warning-soft text-warning-fg", Icon: AlertTriangle },
  danger: { cls: "border-danger-border bg-danger-soft text-danger-fg", Icon: AlertCircle },
};

export function Alert({ tone = "info", title, children, action, className, role }: { tone?: AlertTone; title?: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string; role?: "alert" | "status" }) {
  const { cls, Icon } = alertTones[tone];
  return (
    <div role={role} className={cn("flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start", cls, className)}>
      <div className="flex min-w-0 flex-1 gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 text-base">
          {title && <p className="font-semibold">{title}</p>}
          {children && <div className={cn(title && "mt-0.5", "[&_a]:underline")}>{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 gap-2 pl-6 sm:pl-0">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className, compact }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "gap-2 px-4 py-8" : "gap-3 px-6 py-14", className)}>
      {icon && <div className="flex size-11 items-center justify-center rounded-lg border border-border bg-surface-sunken text-fg-muted [&_svg]:size-5">{icon}</div>}
      <div className="flex max-w-sm flex-col gap-1">
        <p className="text-md font-semibold text-fg">{title}</p>
        {description && <p className="text-base text-fg-muted">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Couldn't load this", error, onRetry, className }: { title?: string; error?: unknown; onRetry?: () => void; className?: string }) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Something went wrong.";
  return (
    <div role="alert" className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      <div className="flex size-11 items-center justify-center rounded-lg border border-danger-border bg-danger-soft text-danger-fg">
        <AlertCircle className="size-5" aria-hidden />
      </div>
      <div className="flex max-w-md flex-col gap-1">
        <p className="text-md font-semibold">{title}</p>
        <p className="text-base text-fg-muted">{message}</p>
        {error !== null && typeof error === "object" && "requestId" in error ? <p className="font-mono text-xs text-fg-subtle">Request ID: {String((error as { requestId: string }).requestId)}</p> : null}
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}
