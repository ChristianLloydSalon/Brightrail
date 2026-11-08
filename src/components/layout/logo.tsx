import { cn } from "@/lib/utils";

/** Brightrail mark: two stations joined by a rail, with a stop along the way. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden focusable="false">
      <rect width="32" height="32" rx="7" fill="var(--primary)" />
      <path d="M9 10.5h6.5a3.5 3.5 0 0 1 3.5 3.5v4a3.5 3.5 0 0 0 3.5 3.5H23" fill="none" stroke="var(--primary-fg)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="9" cy="10.5" r="2.6" fill="var(--primary-fg)" />
      <circle cx="23" cy="21.5" r="2.6" fill="var(--primary-fg)" />
      <circle cx="19" cy="16" r="1.6" fill="var(--primary)" stroke="var(--primary-fg)" strokeWidth="1.6" />
    </svg>
  );
}

export function Logo({ className, collapsed }: { className?: string; collapsed?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!collapsed && <span className="text-[17px] font-semibold tracking-tight text-fg">Brightrail</span>}
    </span>
  );
}
