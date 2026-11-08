import { AlertTriangle, Archive, Ban, Check, Clock, Hand, Loader2, Mail, Minus, Pause, Pencil, Plug, RotateCw, X } from "lucide-react";
import * as React from "react";
import type { StatusIcon, StatusMeta, Tone } from "@/lib/domain/status";
import { cn } from "@/lib/utils";

const tones: Record<Tone, string> = {
  success: "bg-success-soft text-success-fg border-success-border",
  warning: "bg-warning-soft text-warning-fg border-warning-border",
  danger: "bg-danger-soft text-danger-fg border-danger-border",
  info: "bg-info-soft text-info-fg border-info-border",
  neutral: "bg-neutral-soft text-neutral-fg border-border",
  primary: "bg-primary-soft text-primary-soft-fg border-primary-border",
};

export function Badge({ tone = "neutral", className, children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-1.5 text-sm font-medium whitespace-nowrap", tones[tone], className)} {...props}>
      {children}
    </span>
  );
}

const ICONS: Record<StatusIcon, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  check: Check, x: X, clock: Clock, spinner: Loader2, pause: Pause, archive: Archive, pencil: Pencil, ban: Ban, rotate: RotateCw, hand: Hand, dash: Minus, plug: Plug, alert: AlertTriangle, mail: Mail,
};

export function StatusIconGlyph({ icon, className }: { icon: StatusIcon; className?: string }) {
  const Icon = ICONS[icon];
  return <Icon className={cn("size-3.5", icon === "spinner" && "animate-spin", className)} aria-hidden />;
}

/** Status pill: icon + text + tone. Status is never conveyed by color alone. */
export function StatusBadge({ meta, className, label }: { meta: StatusMeta; className?: string; label?: string }) {
  return (
    <Badge tone={meta.tone} className={className} title={meta.description}>
      <StatusIconGlyph icon={meta.icon} />
      {label ?? meta.label}
    </Badge>
  );
}
