import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-fg-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {c.href && !last ? (
                <Link href={c.href} className="truncate rounded-xs hover:text-fg hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn("truncate", last && "text-fg")}>{c.label}</span>
              )}
              {!last && <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({ title, description, breadcrumbs, actions, meta, className }: { title: React.ReactNode; description?: React.ReactNode; breadcrumbs?: Crumb[]; actions?: React.ReactNode; meta?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 pb-5", className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance text-fg">{title}</h1>
          {description && <p className="max-w-3xl text-base text-fg-muted">{description}</p>}
          {meta && <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Standard page padding and max width. */
export function PageContainer({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-6", wide ? "max-w-[1600px]" : "max-w-7xl", className)}>{children}</div>;
}
