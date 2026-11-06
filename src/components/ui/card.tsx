import * as React from "react";
import { cn } from "@/lib/utils";

/** Bordered surface. Used sparingly: sections, not every element. */
export function Panel({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-lg border border-border bg-surface", className)} {...props} />;
}

export function PanelHeader({ title, description, actions, className, as: H = "h2", id }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; as?: "h2" | "h3"; id?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3", className)}>
      <div className="min-w-0">
        <H id={id} className="text-md font-semibold text-fg">{title}</H>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PanelBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...props} />;
}

/** Definition list for key/value metadata. */
export function DescriptionList({ items, className, columns = 2 }: { items: Array<{ term: React.ReactNode; value: React.ReactNode }>; className?: string; columns?: 1 | 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-sm text-fg-muted">{it.term}</dt>
          <dd className="min-w-0 text-base break-words text-fg">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-border-strong bg-surface-sunken px-1 font-mono text-xs text-fg-muted">{children}</kbd>;
}

export function Avatar({ name, className, size = "md" }: { name: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const palette = ["#ad3209", "#2f456a", "#1d7a3d", "#7c4400", "#6b3fa0", "#1c468f", "#8e1d14"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", size === "sm" && "size-6 text-[10px]", size === "md" && "size-8 text-xs", size === "lg" && "size-12 text-base", className)}
      style={{ backgroundColor: palette[h % palette.length] }}
    >
      {initials}
    </span>
  );
}

/** Small mono identifier with copy-friendly styling. */
export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <code className={cn("rounded-xs bg-surface-sunken px-1 py-0.5 font-mono text-[0.8125em] text-fg", className)}>{children}</code>;
}
