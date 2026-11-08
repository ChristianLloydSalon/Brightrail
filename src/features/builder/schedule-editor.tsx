"use client";

import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Fieldset } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { checkSchedule, defaultSchedule, INTERVAL_MINUTES, nextRuns, WEEKDAYS, type ScheduleMode, type ScheduleSpec } from "@/lib/engine/schedule";

const MODES: Array<{ value: ScheduleMode; label: string }> = [
  { value: "once", label: "Once, at a date and time" },
  { value: "interval", label: "Every few minutes or hours" },
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "On certain days of the week" },
  { value: "monthly", label: "Once a month" },
  { value: "cron", label: "Custom (cron expression)" },
];

const zones = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
})();

/** Friendly schedule picker with a live preview of the next runs. Writes a ScheduleSpec. */
export function ScheduleEditor({ id, value, onChange, error, disabled, workspaceTimezone }: { id: string; value: ScheduleSpec | undefined; onChange: (s: ScheduleSpec, key?: string) => void; error: string | null; disabled?: boolean; workspaceTimezone: string }) {
  const s = value ?? defaultSchedule(workspaceTimezone);
  const set = (patch: Partial<ScheduleSpec>, key?: string) => onChange({ ...s, ...patch }, key);
  const check = checkSchedule(s);
  const preview = React.useMemo(() => {
    if (check.error) return [];
    try {
      return nextRuns(s, new Date(), 3, check.cron);
    } catch {
      return [];
    }
  }, [s, check.cron, check.error]);
  const fmt = (d: Date) => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: s.timezone }).format(d);

  return (
    <div className="flex flex-col gap-4">
      <Field label="Runs">{(p) => <Select<ScheduleMode> {...p} value={s.mode} disabled={disabled} onValueChange={(mode) => set({ mode })} options={MODES} />}</Field>

      {s.mode === "interval" && (
        <Field label="How often">
          {(p) => <Select {...p} value={String(s.everyMinutes ?? 60)} disabled={disabled} onValueChange={(v) => set({ everyMinutes: Number(v) })} options={INTERVAL_MINUTES.map((n) => ({ value: String(n), label: n < 60 ? `Every ${n} minutes` : n === 60 ? "Every hour" : `Every ${n / 60} hours` }))} />}
        </Field>
      )}

      {s.mode === "weekly" && (
        <Fieldset legend="Days">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {WEEKDAYS.map((d, i) => {
              const cid = `${id}-day-${i}`;
              const on = (s.days ?? []).includes(i);
              return (
                <label key={d} htmlFor={cid} className="flex items-center gap-2 text-sm">
                  <Checkbox id={cid} checked={on} disabled={disabled} onCheckedChange={(v) => set({ days: v === true ? [...(s.days ?? []), i] : (s.days ?? []).filter((x) => x !== i) })} />
                  {d.slice(0, 3)}
                </label>
              );
            })}
          </div>
        </Fieldset>
      )}

      {s.mode === "monthly" && (
        <Field label="Day of the month" description="1–28, so it runs every month.">
          {(p) => <Select {...p} value={String(s.dayOfMonth ?? 1)} disabled={disabled} onValueChange={(v) => set({ dayOfMonth: Number(v) })} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} />}
        </Field>
      )}

      {s.mode === "once" && (
        <Field label="Date" description="Within the next 12 months.">
          {(p) => <Input {...p} type="date" value={s.date ?? ""} disabled={disabled} onChange={(e) => set({ date: e.target.value }, "date")} className="w-44" />}
        </Field>
      )}

      {(s.mode === "once" || s.mode === "daily" || s.mode === "weekly" || s.mode === "monthly") && (
        <Field label="Time" description="24-hour clock.">
          {(p) => <Input {...p} type="time" value={s.time ?? "09:00"} disabled={disabled} onChange={(e) => set({ time: e.target.value }, "time")} className="w-36" />}
        </Field>
      )}

      {s.mode === "cron" && (
        <Field label="Cron expression" description="minute hour day-of-month month day-of-week — e.g. 0 9 * * 1-5 is 09:00 on weekdays.">
          {(p) => <Input {...p} value={s.cron ?? ""} disabled={disabled} onChange={(e) => set({ cron: e.target.value }, "cron")} className="font-mono" placeholder="0 9 * * 1-5" />}
        </Field>
      )}

      <Field label="Time zone" description="Daylight-saving changes are handled for you.">
        {(p) => (
          <>
            <Input {...p} list={`${id}-zones`} value={s.timezone} disabled={disabled} onChange={(e) => set({ timezone: e.target.value.trim() }, "tz")} className="font-mono" />
            <datalist id={`${id}-zones`}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
          </>
        )}
      </Field>

      {error ?? check.error ? (
        <p className="text-sm text-danger-fg dark:text-danger" role="alert">{error ?? check.error}</p>
      ) : (
        <div className="rounded-md border border-border bg-surface-sunken p-3 text-sm">
          <p className="font-medium">{s.mode === "once" ? "Runs once" : "Next runs"}</p>
          <ul className="mt-1 text-fg-muted">{preview.map((d) => <li key={d.toISOString()} className="tabular">{fmt(d)}</li>)}</ul>
          <p className="mt-2 text-xs text-fg-subtle">Takes effect when you publish.{s.mode === "once" ? " After it runs, the schedule switches itself off." : ""} Runs start with no input data, plus a <code>scheduledFor</code> timestamp.</p>
        </div>
      )}
    </div>
  );
}
