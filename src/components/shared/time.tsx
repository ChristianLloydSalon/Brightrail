"use client";

import * as React from "react";
import { formatDateTime, formatRelative } from "@/lib/format";

/** Relative time with the absolute timestamp available to everyone (title + visually hidden text not needed: datetime attr). */
export function RelativeTime({ iso, className }: { iso?: string | null; className?: string }) {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!iso) return <span className={className}>—</span>;
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className={className}>
      {formatRelative(iso)}
    </time>
  );
}
