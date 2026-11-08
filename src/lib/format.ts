const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const dateOnly = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const timeOnly = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  return dateTime.format(new Date(iso));
}
export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  return dateOnly.format(new Date(iso));
}
export function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  return timeOnly.format(new Date(iso));
}

export function formatRelative(iso?: string | null, now = Date.now()): string {
  if (!iso) return "Never";
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return diff <= 0 ? "just now" : "in a few seconds";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return formatDate(iso);
}

export function formatDuration(startIso?: string, endIso?: string, now = Date.now()): string {
  if (!startIso) return "—";
  const ms = (endIso ? new Date(endIso).getTime() : now) - new Date(startIso).getTime();
  return formatMs(ms);
}

export function formatMs(ms: number): string {
  if (ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatPercent(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
