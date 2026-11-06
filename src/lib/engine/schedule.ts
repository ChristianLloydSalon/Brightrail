import { CronExpressionParser } from "cron-parser";

/**
 * Schedule trigger specification. People pick a preset; "cron" is the escape hatch.
 * Everything resolves to a 5-field cron expression evaluated in `timezone` (DST-aware).
 */
export type ScheduleMode = "once" | "interval" | "daily" | "weekly" | "monthly" | "cron";

export interface ScheduleSpec {
  mode: ScheduleMode;
  /** interval: one of INTERVAL_MINUTES */
  everyMinutes?: number;
  /** once: "YYYY-MM-DD" in `timezone` */
  date?: string;
  /** once/daily/weekly/monthly: "HH:MM" 24h */
  time?: string;
  /** weekly: 0 = Sunday … 6 = Saturday */
  days?: number[];
  /** monthly: 1–28 (avoids months without a 29th–31st) */
  dayOfMonth?: number;
  /** cron: 5 fields */
  cron?: string;
  /** IANA zone, e.g. Asia/Singapore */
  timezone: string;
}

export const INTERVAL_MINUTES = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720] as const;
export const MIN_GAP_MINUTES = 5;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const defaultSchedule = (timezone = "UTC"): ScheduleSpec => {
  const tomorrow = isValidTimezone(timezone) ? localDate(new Date(Date.now() + 86_400_000), timezone) : new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  return { mode: "daily", time: "09:00", days: [1, 2, 3, 4, 5], everyMinutes: 60, dayOfMonth: 1, date: tomorrow, timezone };
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar date (YYYY-MM-DD) of an instant as seen in `tz`. */
function localDate(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * The single instant for a "once" schedule, or an error. Uses the yearly cron "m h D M *" and checks the
 * next occurrence lands on the requested date, which also rejects past dates and dates over a year away.
 */
export function onceAt(s: ScheduleSpec, from = new Date()): { at: Date } | { error: string } {
  const d = DATE.exec(s.date ?? "");
  const t = TIME.exec(s.time ?? "");
  if (!d) return { error: "Pick a date." };
  if (!t) return { error: "Enter a time like 09:00 (24-hour)." };
  const cron = `${Number(t[2])} ${Number(t[1])} ${Number(d[3])} ${Number(d[2])} *`;
  let at: Date;
  try {
    at = CronExpressionParser.parse(cron, { tz: s.timezone, currentDate: from }).next().toDate();
  } catch {
    return { error: "That date doesn't exist." };
  }
  if (localDate(at, s.timezone) !== s.date) {
    const today = localDate(from, s.timezone);
    return { error: (s.date ?? "") <= today ? "Pick a date and time in the future." : "Pick a date within the next 12 months." };
  }
  return { at };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Builds the cron expression, or returns an error message a person can act on. */
export function scheduleToCron(s: ScheduleSpec): { cron: string } | { error: string } {
  const hm = (t: string | undefined) => {
    const m = TIME.exec(t ?? "");
    return m ? { h: Number(m[1]), m: Number(m[2]) } : null;
  };
  switch (s.mode) {
    case "once": {
      const d = DATE.exec(s.date ?? "");
      const t = hm(s.time);
      if (!d) return { error: "Pick a date." };
      if (!t) return { error: "Enter a time like 09:00 (24-hour)." };
      return { cron: `${t.m} ${t.h} ${Number(d[3])} ${Number(d[2])} *` };
    }
    case "interval": {
      const n = s.everyMinutes ?? 0;
      if (!(INTERVAL_MINUTES as readonly number[]).includes(n)) return { error: "Choose how often it runs." };
      return { cron: n < 60 ? `*/${n} * * * *` : n === 60 ? "0 * * * *" : `0 */${n / 60} * * *` };
    }
    case "daily":
    case "weekly":
    case "monthly": {
      const t = hm(s.time);
      if (!t) return { error: "Enter a time like 09:00 (24-hour)." };
      if (s.mode === "daily") return { cron: `${t.m} ${t.h} * * *` };
      if (s.mode === "weekly") {
        const days = [...new Set(s.days ?? [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
        if (!days.length) return { error: "Pick at least one day." };
        return { cron: `${t.m} ${t.h} * * ${days.join(",")}` };
      }
      const d = s.dayOfMonth ?? 0;
      if (!Number.isInteger(d) || d < 1 || d > 28) return { error: "Pick a day between 1 and 28." };
      return { cron: `${t.m} ${t.h} ${d} * *` };
    }
    case "cron": {
      const c = (s.cron ?? "").trim().replace(/\s+/g, " ");
      if (c.split(" ").length !== 5) return { error: "Use 5 fields: minute hour day-of-month month day-of-week." };
      return { cron: c };
    }
  }
}

/** Validates the whole spec, including timezone and the minimum gap between runs. */
export function checkSchedule(s: ScheduleSpec | undefined): { cron: string; error?: undefined } | { error: string; cron?: undefined } {
  if (!s) return { error: "Set when the workflow should run." };
  if (!isValidTimezone(s.timezone)) return { error: "Choose a valid time zone." };
  if (s.mode === "once") {
    const o = onceAt(s);
    if ("error" in o) return o;
    const built = scheduleToCron(s);
    return "error" in built ? built : { cron: built.cron };
  }
  const built = scheduleToCron(s);
  if ("error" in built) return built;
  try {
    const runs = nextRuns(s, new Date(), 4, built.cron);
    if (runs.length < 2) return { error: "This schedule never runs." };
    for (let i = 1; i < runs.length; i++)
      if (runs[i]!.getTime() - runs[i - 1]!.getTime() < MIN_GAP_MINUTES * 60_000) return { error: `Runs must be at least ${MIN_GAP_MINUTES} minutes apart.` };
  } catch {
    return { error: "That cron expression isn't valid." };
  }
  return built;
}

export function nextRuns(s: ScheduleSpec, from: Date, count: number, cron?: string): Date[] {
  if (s.mode === "once") {
    const o = onceAt(s, from);
    return "error" in o ? [] : [o.at];
  }
  const expr = cron ?? (() => { const b = scheduleToCron(s); if ("error" in b) throw new Error(b.error); return b.cron; })();
  const it = CronExpressionParser.parse(expr, { tz: s.timezone, currentDate: from });
  const out: Date[] = [];
  for (let i = 0; i < count; i++) out.push(it.next().toDate());
  return out;
}

export function nextRunAfter(cron: string, timezone: string, from: Date): Date {
  return CronExpressionParser.parse(cron, { tz: timezone, currentDate: from }).next().toDate();
}

/** Plain-language summary, e.g. “Weekdays at 09:00 (Asia/Singapore)”. */
export function describeSchedule(s: ScheduleSpec | undefined): string {
  if (!s) return "No schedule set";
  const tz = ` (${s.timezone})`;
  switch (s.mode) {
    case "once": {
      const d = DATE.exec(s.date ?? "");
      const label = d ? new Date(Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : s.date;
      return `Once on ${label} at ${s.time}${tz}`;
    }
    case "interval": {
      const n = s.everyMinutes ?? 0;
      return n < 60 ? `Every ${n} minutes` : n === 60 ? "Every hour" : `Every ${n / 60} hours`;
    }
    case "daily":
      return `Every day at ${s.time}${tz}`;
    case "weekly": {
      const d = [...(s.days ?? [])].sort().join(",");
      const label = d === "1,2,3,4,5" ? "Weekdays" : d === "0,6" ? "Weekends" : (s.days ?? []).slice().sort().map((x) => WEEKDAYS[x]!.slice(0, 3)).join(", ");
      return `${label} at ${s.time}${tz}`;
    }
    case "monthly":
      return `Monthly on day ${s.dayOfMonth} at ${s.time}${tz}`;
    case "cron":
      return `Cron “${s.cron}”${tz}`;
  }
}
