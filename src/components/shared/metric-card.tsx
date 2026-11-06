import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

export function MetricCard({ label, value, hint, delta, deltaGoodWhen = "up", href, icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; delta?: { value: number; label: string }; deltaGoodWhen?: "up" | "down"; href?: string; icon?: React.ReactNode }) {
  const dir = !delta || delta.value === 0 ? "flat" : delta.value > 0 ? "up" : "down";
  const good = dir === "flat" ? null : dir === deltaGoodWhen;
  const DeltaIcon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg-muted">{label}</span>
        {icon && <span className="text-fg-subtle [&_svg]:size-4" aria-hidden>{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight tabular">{value}</span>
        {delta && (
          <span className={cn("inline-flex items-center gap-0.5 text-sm font-medium", good === true && "text-success-fg dark:text-success", good === false && "text-danger-fg dark:text-danger", good === null && "text-fg-muted")}>
            <DeltaIcon className="size-3.5" aria-hidden />
            {Math.abs(delta.value)}
            <span className="sr-only"> {dir === "up" ? "more" : dir === "down" ? "fewer" : "change"} {delta.label}</span>
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-sm text-fg-subtle">{hint}</p>}
    </>
  );
  const cls = "block rounded-lg border border-border bg-surface p-4";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-border-strong hover:bg-surface-hover/40")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Meter({ label, value, max, hint }: { label: string; value: number; max: number; hint?: string }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  const tone = pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warning" : "bg-secondary";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-fg">{label}</span>
        <span className="text-fg-muted tabular">
          {value.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} of ${max} (${pct}%)`} className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      </div>
      {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}
