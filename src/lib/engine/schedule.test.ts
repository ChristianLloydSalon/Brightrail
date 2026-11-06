import { describe, expect, it } from "vitest";
import { checkSchedule, describeSchedule, nextRunAfter, nextRuns, onceAt, scheduleToCron } from "./schedule";

describe("schedule trigger", () => {
  it("builds cron from presets", () => {
    expect(scheduleToCron({ mode: "interval", everyMinutes: 15, timezone: "UTC" })).toEqual({ cron: "*/15 * * * *" });
    expect(scheduleToCron({ mode: "interval", everyMinutes: 60, timezone: "UTC" })).toEqual({ cron: "0 * * * *" });
    expect(scheduleToCron({ mode: "interval", everyMinutes: 360, timezone: "UTC" })).toEqual({ cron: "0 */6 * * *" });
    expect(scheduleToCron({ mode: "daily", time: "09:30", timezone: "UTC" })).toEqual({ cron: "30 9 * * *" });
    expect(scheduleToCron({ mode: "weekly", time: "08:00", days: [5, 1, 1], timezone: "UTC" })).toEqual({ cron: "0 8 * * 1,5" });
    expect(scheduleToCron({ mode: "monthly", time: "00:00", dayOfMonth: 28, timezone: "UTC" })).toEqual({ cron: "0 0 28 * *" });
  });

  it("rejects bad input with plain-language errors", () => {
    expect(checkSchedule({ mode: "interval", everyMinutes: 1, timezone: "UTC" }).error).toMatch(/how often/);
    expect(checkSchedule({ mode: "daily", time: "25:00", timezone: "UTC" }).error).toMatch(/time like/);
    expect(checkSchedule({ mode: "weekly", time: "09:00", days: [], timezone: "UTC" }).error).toMatch(/at least one day/);
    expect(checkSchedule({ mode: "monthly", time: "09:00", dayOfMonth: 31, timezone: "UTC" }).error).toMatch(/1 and 28/);
    expect(checkSchedule({ mode: "daily", time: "09:00", timezone: "Mars/Base" }).error).toMatch(/time zone/);
    expect(checkSchedule({ mode: "cron", cron: "* * * * *", timezone: "UTC" }).error).toMatch(/5 minutes apart/);
    expect(checkSchedule({ mode: "cron", cron: "0 9 * *", timezone: "UTC" }).error).toMatch(/5 fields/);
    expect(checkSchedule({ mode: "cron", cron: "99 9 * * *", timezone: "UTC" }).error).toBeTruthy();
    expect(checkSchedule(undefined).error).toBeTruthy();
    expect(checkSchedule({ mode: "cron", cron: "0 9 * * 1-5", timezone: "Asia/Singapore" }).cron).toBe("0 9 * * 1-5");
  });

  it("evaluates in the chosen time zone, including DST", () => {
    // 09:00 Singapore = 01:00 UTC; Thu 5 Nov 2026 10:00 UTC → next is Fri 6 Nov.
    const sg = nextRuns({ mode: "weekly", time: "09:00", days: [1, 2, 3, 4, 5], timezone: "Asia/Singapore" }, new Date("2026-11-05T10:00:00Z"), 2);
    expect(sg.map((d) => d.toISOString())).toEqual(["2026-11-06T01:00:00.000Z", "2026-11-09T01:00:00.000Z"]);
    // New York 09:00 is 13:00 UTC before DST ends (1 Nov 2026) and 14:00 UTC after.
    expect(nextRunAfter("0 9 * * *", "America/New_York", new Date("2026-10-31T12:00:00Z")).toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(nextRunAfter("0 9 * * *", "America/New_York", new Date("2026-11-01T12:00:00Z")).toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  it("describes schedules for people", () => {
    expect(describeSchedule({ mode: "weekly", time: "09:00", days: [1, 2, 3, 4, 5], timezone: "Asia/Singapore" })).toBe("Weekdays at 09:00 (Asia/Singapore)");
    expect(describeSchedule({ mode: "interval", everyMinutes: 120, timezone: "UTC" })).toBe("Every 2 hours");
    expect(describeSchedule({ mode: "weekly", time: "07:15", days: [3, 0], timezone: "UTC" })).toBe("Sun, Wed at 07:15 (UTC)");
  });

  it("runs once at a specific local date and time", () => {
    const from = new Date("2026-11-05T10:00:00Z"); // 18:00 in Singapore
    const once = (date: string, time = "09:00", timezone = "Asia/Singapore") => onceAt({ mode: "once", date, time, timezone }, from);
    expect(once("2026-11-06")).toEqual({ at: new Date("2026-11-06T01:00:00Z") });
    expect(once("2026-11-05", "19:30")).toEqual({ at: new Date("2026-11-05T11:30:00Z") });
    expect(once("2026-11-05", "17:00")).toEqual({ error: "Pick a date and time in the future." });
    expect(once("2026-10-01")).toEqual({ error: "Pick a date and time in the future." });
    expect(once("2028-01-01")).toEqual({ error: "Pick a date within the next 12 months." });
    expect(once("2026-02-30")).toHaveProperty("error");
    expect(once("2026-11-06", "09:00", "America/New_York")).toEqual({ at: new Date("2026-11-06T14:00:00Z") });
    expect(nextRuns({ mode: "once", date: "2026-11-06", time: "09:00", timezone: "Asia/Singapore" }, from, 3)).toHaveLength(1);
    expect(checkSchedule({ mode: "once", date: "2000-01-01", time: "09:00", timezone: "UTC" }).error).toMatch(/future/);
    expect(describeSchedule({ mode: "once", date: "2026-11-06", time: "09:00", timezone: "Asia/Singapore" })).toBe("Once on 6 Nov 2026 at 09:00 (Asia/Singapore)");
  });
});
