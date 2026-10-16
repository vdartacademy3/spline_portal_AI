import { describe, expect, it } from "vitest";

import {
  aggregateMonthly,
  computeMetrics,
  localDateTimeAt,
  localMinutesAt,
  monthBounds,
} from "./attendance.functions";
import type { MonthlyRecord } from "./attendance.functions";

/**
 * A stored attendance row, defaulting to a completed present day of 8h.
 *
 * `work_minutes` defaults to 480 unless the caller overrides either it or the
 * legacy `work_hours`, so tests that only set `work_hours` still describe the
 * duration they intend.
 */
function row(over: Partial<MonthlyRecord> & { day: string }): MonthlyRecord {
  const workMinutes =
    over.work_minutes !== undefined && over.work_minutes !== null
      ? over.work_minutes
      : over.work_hours != null
        ? Math.round(over.work_hours * 60)
        : 480;
  return {
    work_date: over.day,
    check_in: over.check_in === undefined ? `${over.day}T09:00:00+00:00` : over.check_in,
    check_out: over.check_out === undefined ? `${over.day}T18:00:00+00:00` : over.check_out,
    status: over.status === undefined ? "present" : over.status,
    late_minutes: over.late_minutes ?? 0,
    early_login_minutes: over.early_login_minutes ?? 0,
    overtime_minutes: over.overtime_minutes ?? 0,
    late_logout_minutes: over.late_logout_minutes ?? 0,
    early_departure_minutes: over.early_departure_minutes ?? 0,
    work_minutes: over.work_minutes === null ? null : workMinutes,
    work_hours:
      over.work_hours !== undefined
        ? over.work_hours
        : over.work_minutes === null
          ? null
          : workMinutes / 60,
  };
}

/** Mirrors the `shifts` rows read from PostgreSQL (see verification report). */
type Shift = {
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_minutes: number;
  overtime_after_minutes: number;
  minimum_hours: number;
  half_day_hours: number;
  overnight: boolean;
};

const GEN: Shift = {
  start_time: "09:00:00",
  end_time: "18:00:00",
  break_minutes: 60,
  grace_minutes: 30,
  overtime_after_minutes: 30,
  minimum_hours: 8,
  half_day_hours: 4,
  overnight: false,
};

/** A zero-grace, zero-threshold, zero-break shift so the spec's literal examples reproduce exactly. */
const PLAIN: Shift = {
  start_time: "09:00:00",
  end_time: "18:00:00",
  break_minutes: 0,
  grace_minutes: 0,
  overtime_after_minutes: 0,
  minimum_hours: 8,
  half_day_hours: 4,
  overnight: false,
};

const NIGHT: Shift = {
  start_time: "22:00:00",
  end_time: "06:00:00",
  break_minutes: 45,
  grace_minutes: 15,
  overtime_after_minutes: 30,
  minimum_hours: 8,
  half_day_hours: 4,
  overnight: true,
};

/** The spec's overnight example: 22:00 -> 07:00 with a 60m unpaid break (8h net). */
const NIGHT_2200_0700: Shift = {
  start_time: "22:00:00",
  end_time: "07:00:00",
  break_minutes: 60,
  grace_minutes: 15,
  overtime_after_minutes: 30,
  minimum_hours: 8,
  half_day_hours: 4,
  overnight: true,
};

const DAY = "2026-09-01";

/** Build a UTC ISO instant; accepts "HH:MM" or "HH:MM:SS". */
function at(time: string, day = DAY) {
  return `${day}T${time.slice(0, 5)}:00.000Z`;
}

function metrics(shift: Shift | null, cin: string, cout: string | null, day = DAY) {
  return computeMetrics({
    shift: shift as never,
    localDate: day,
    localCheckIn: cin,
    localCheckOut: cout,
    checkInIso: at(cin, day),
    checkOutIso: cout ? at(cout, day) : null,
  });
}

describe("attendance metrics against the assigned shift", () => {
  it("early login: shift 09:00, check-in 08:45 -> 15m", () => {
    const m = metrics(PLAIN, "08:45", "18:00");
    expect(m.early_login_minutes).toBe(15);
    expect(m.late_minutes).toBe(0);
    expect(m.early_departure_minutes).toBe(0);
  });

  it("late login: shift 09:00, check-in 09:20 -> 20m", () => {
    const m = metrics(PLAIN, "09:20", "18:00");
    expect(m.late_minutes).toBe(20);
    expect(m.early_login_minutes).toBe(0);
  });

  it("early logout: shift ends 18:00, check-out 17:30 -> 30m", () => {
    const m = metrics(PLAIN, "09:00", "17:30");
    expect(m.early_departure_minutes).toBe(30);
    expect(m.late_logout_minutes).toBe(0);
  });

  it("late logout: shift ends 18:00, check-out 18:30 -> 30m", () => {
    const m = metrics(PLAIN, "09:00", "18:30");
    expect(m.late_logout_minutes).toBe(30);
  });

  it("overtime: shift ends 18:00, check-out 19:00 -> 1h", () => {
    const m = metrics(PLAIN, "09:00", "19:00");
    expect(m.overtime_minutes).toBe(60);
    expect(m.late_logout_minutes).toBe(60);
  });

  it("work_minutes is the exact integer duration, break deducted once", () => {
    // 08:45 -> 17:30 is 525m elapsed, less GEN's 60m break = 465m = 7h 45m.
    const m = metrics(GEN, "08:45", "17:30");
    expect(m.work_minutes).toBe(465);
    expect(m.work_hours).toBe(7.75);
  });

  it("work_minutes is not quantised to 6-minute increments", () => {
    // 08:47 -> 18:42 = 595m elapsed, less 60m break = 535m = 8h 55m.
    const m = metrics(GEN, "08:47", "18:42");
    expect(m.work_minutes).toBe(535);
    expect(m.work_minutes! % 6).not.toBe(0);
  });

  it("derives an odd-minute duration the 2dp column could not represent", () => {
    // 09:01 -> 17:00 = 479m elapsed, less 60m break = 419m (6h 59m).
    // 419m/60 = 6.9833h, which the 2dp column rounds to 6.98 (= 418.8m);
    // the integer column is the authoritative value either way.
    const m = metrics(GEN, "09:01", "17:00");
    expect(m.work_minutes).toBe(419);
    expect(m.work_hours).toBe(6.98);
  });

  it("no check-out leaves work_minutes null", () => {
    const m = metrics(GEN, "09:00", null);
    expect(m.work_minutes).toBeNull();
    expect(m.work_hours).toBeNull();
  });

  it("overtime is measured against the shift net duration, not the elapsed span", () => {
    // 09:00 -> 19:00 on a 9h-1h = 8h net shift is 540m actual, so 60m overtime.
    const m = metrics(GEN, "09:00", "19:00");
    expect(m.work_minutes).toBe(540);
    expect(m.overtime_minutes).toBe(60);
    // A day matching the shift exactly nets 480m, so no overtime despite
    // a 60m late logout.
    const exact = metrics(GEN, "09:00", "18:00");
    expect(exact.work_minutes).toBe(480);
    expect(exact.overtime_minutes).toBe(0);
  });

  it("a zero-break shift deducts nothing and still yields exact minutes", () => {
    const m = metrics(PLAIN, "08:45", "17:30");
    expect(m.work_minutes).toBe(525);
  });

  it("elapsed working hours = checkout - checkin, exactly", () => {
    // 08:47 -> 18:42 is 9h 55m (595m). No 6-minute quantisation.
    expect(metrics(PLAIN, "08:47", "18:42").work_hours).toBe(9.92);
  });

  it("working hours are exact to the minute, not quantised to 6 minutes", () => {
    // The spec's worked example: 08:45 -> 17:30 with a 60m unpaid break.
    // Elapsed 8h 45m (525m) - 60m = 465m = 7h 45m, not 7.8h.
    const m = metrics(GEN, "08:45", "17:30");
    expect(m.work_hours).toBe(7.75);
    expect(Math.round((m.work_hours ?? 0) * 60)).toBe(465);
  });

  it("the unpaid break is deducted exactly once", () => {
    // Same elapsed time, with and without the 60m break, differ by exactly 60m.
    const withBreak = metrics(GEN, "08:45", "17:30");
    const noBreak = metrics(PLAIN, "08:45", "17:30");
    expect(Math.round((withBreak.work_hours ?? 0) * 60)).toBe(465);
    expect(Math.round((noBreak.work_hours ?? 0) * 60)).toBe(525);
    expect(
      Math.round((noBreak.work_hours ?? 0) * 60) - Math.round((withBreak.work_hours ?? 0) * 60),
    ).toBe(60);
  });

  it("real GEN shift: net working hours deduct the unpaid break", () => {
    // 9h 55m elapsed (595m), less the 60m unpaid break = 535m = 8h 55m.
    const m = metrics(GEN, "08:47", "18:42");
    expect(m.work_hours).toBe(8.92);
    expect(Math.round((m.work_hours ?? 0) * 60)).toBe(535);
  });

  it("real GEN shift: 30m grace forgives a 09:20 check-in", () => {
    expect(metrics(GEN, "09:20", "18:00").late_minutes).toBe(0);
    // One minute past the grace window is late.
    expect(metrics(GEN, "09:31", "18:00").late_minutes).toBe(1);
  });

  it("overtime is the actual net time beyond the shift's net scheduled time", () => {
    // Spec example: 09:00 -> 19:00 on a 09:00-18:00 shift with a 60m break.
    // Scheduled net = 540m - 60m = 480m (8h). Actual net = 600m - 60m = 540m (9h).
    // Overtime = 60m (1h).
    const m = metrics(GEN, "09:00", "19:00");
    expect(m.work_hours).toBe(9);
    expect(m.late_logout_minutes).toBe(60);
    expect(m.overtime_minutes).toBe(60);
  });

  it("overtime is zero when the net time matches the net scheduled time", () => {
    // 09:00 -> 18:00 is exactly 8h net against an 8h net schedule.
    const m = metrics(GEN, "09:00", "18:00");
    expect(m.work_hours).toBe(8);
    expect(m.overtime_minutes).toBe(0);
  });

  it("overtime counts net time, not clock time past the shift end", () => {
    // Leaving 60m early but starting 60m early still nets the full 8h, so no overtime.
    const m = metrics(GEN, "08:00", "17:00");
    expect(m.work_hours).toBe(8);
    expect(m.early_login_minutes).toBe(60);
    expect(m.early_departure_minutes).toBe(60);
    expect(m.overtime_minutes).toBe(0);
  });

  it("missing checkout leaves work hours null and logs no logout variance", () => {
    const m = metrics(GEN, "08:50", null);
    expect(m.work_hours).toBeNull();
    expect(m.early_login_minutes).toBe(10);
    expect(m.overtime_minutes).toBe(0);
    expect(m.late_logout_minutes).toBe(0);
    expect(m.early_departure_minutes).toBe(0);
  });

  it("overnight shift: 22:00-06:00 spans midnight", () => {
    const m = computeMetrics({
      shift: NIGHT as never,
      localDate: "2026-09-01",
      // Bare `HH:MM:SS` is exactly what the UI sends via `toTimeString().slice(0, 8)`.
      localCheckIn: "22:00:00",
      localCheckOut: "06:15:00",
      checkInIso: at("22:00", "2026-09-01"),
      checkOutIso: at("06:15", "2026-09-02"),
    });
    expect(m.late_logout_minutes).toBe(15);
    expect(m.early_departure_minutes).toBe(0);
    // 8h15m elapsed less a 45m break = 450m = 7h 30m.
    expect(m.work_hours).toBe(7.5);
    // Scheduled net = 480m - 45m = 435m. Net 450m is 15m beyond, but the shift's
    // 30m qualification threshold is not crossed, so there is no overtime.
    expect(m.overtime_minutes).toBe(0);
  });

  it("overnight shift: spec example 22:00-07:00 with a 60m break", () => {
    // 21:45 -> 06:15 next day = 510m elapsed, less 60m = 450m = 7h 30m.
    const m = computeMetrics({
      shift: NIGHT_2200_0700 as never,
      localDate: "2026-09-01",
      localCheckIn: "21:45:00",
      localCheckOut: "06:15:00",
      checkInIso: at("21:45", "2026-09-01"),
      checkOutIso: at("06:15", "2026-09-02"),
    });
    expect(m.early_login_minutes).toBe(15);
    // 45m short of the 07:00 scheduled end, on the following day.
    expect(m.early_departure_minutes).toBe(45);
    expect(m.late_logout_minutes).toBe(0);
    expect(m.work_hours).toBe(7.5);
    // No ~24h logout bug: the variance stays under a day.
    expect(m.early_departure_minutes).toBeLessThan(24 * 60);
  });

  it("overnight shift: working to the scheduled end is neither early nor overtime", () => {
    // 22:00 -> 07:00 = 540m elapsed less 60m break = 480m = the 8h net schedule.
    const m = computeMetrics({
      shift: NIGHT_2200_0700 as never,
      localDate: "2026-09-01",
      localCheckIn: "22:00:00",
      localCheckOut: "07:00:00",
      checkInIso: at("22:00", "2026-09-01"),
      checkOutIso: at("07:00", "2026-09-02"),
    });
    expect(m.work_hours).toBe(8);
    expect(m.early_departure_minutes).toBe(0);
    expect(m.late_logout_minutes).toBe(0);
    expect(m.overtime_minutes).toBe(0);
  });

  it("overnight shift: the day offset does not come from the local time string", () => {
    // Regression: deriving the day index from `localCheckOut` (a bare `HH:MM:SS`
    // with no date) produced a ~24h early departure for overnight check-outs.
    const m = computeMetrics({
      shift: NIGHT as never,
      localDate: "2026-09-01",
      localCheckIn: "22:00:00",
      localCheckOut: "06:15:00",
      checkInIso: at("22:00", "2026-09-01"),
      checkOutIso: at("06:15", "2026-09-02"),
    });
    expect(m.early_departure_minutes).toBeLessThan(60);
    expect(m.late_logout_minutes).toBeLessThan(60);
  });

  it("overnight shift: date-prefixed local check-out still resolves the same way", () => {
    const m = computeMetrics({
      shift: NIGHT as never,
      localDate: "2026-09-01",
      localCheckIn: "22:00:00",
      localCheckOut: "2026-09-02 06:15:00",
      checkInIso: at("22:00", "2026-09-01"),
      checkOutIso: at("06:15", "2026-09-02"),
    });
    expect(m.late_logout_minutes).toBe(15);
    expect(m.early_departure_minutes).toBe(0);
    expect(m.work_hours).toBe(7.5);
  });

  it("overnight shift: leaving before midnight is an early logout, not a negative", () => {
    const m = computeMetrics({
      shift: NIGHT as never,
      localDate: "2026-09-01",
      localCheckIn: "22:00:00",
      localCheckOut: "23:00:00",
      checkInIso: at("22:00", "2026-09-01"),
      checkOutIso: at("23:00", "2026-09-01"),
    });
    expect(m.early_departure_minutes).toBeGreaterThan(0);
    expect(m.late_logout_minutes).toBe(0);
    // 60m elapsed less the 45m unpaid break = 15m.
    expect(m.work_hours).toBe(0.25);
    expect(m.overtime_minutes).toBe(0);
  });

  it("work at exactly the half-day boundary is a half day", () => {
    // 09:00 -> 14:00 is 5h elapsed, less the 60m break = 4h, which is the half-day boundary.
    const m = metrics(GEN, "09:00", "14:00");
    expect(m.work_hours).toBe(4);
    expect(m.status).toBe("half_day");
    expect(m.is_half_day).toBe(true);
  });

  it("under the minimum but over the half-day boundary -> early_departure", () => {
    // 09:00 -> 15:00 is 5h net, short of the 8h minimum.
    const m = metrics(GEN, "09:00", "15:00");
    expect(m.status).toBe("early_departure");
  });

  it("no assigned shift still records real elapsed work hours", () => {
    const m = metrics(null, "09:00", "18:00");
    expect(m.work_hours).toBe(9);
    expect(m.early_login_minutes).toBe(0);
    expect(m.late_logout_minutes).toBe(0);
    expect(m.overtime_minutes).toBe(0);
  });
});

describe("monthly aggregation", () => {
  it("resolves the full calendar bounds of a month", () => {
    expect(monthBounds("2026-09")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(monthBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    // Leap year.
    expect(monthBounds("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthBounds("2026-12")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("averages over completed days only", () => {
    // Two completed days at 7h 45m (465m) and 8h 55m (535m), plus one incomplete.
    const s = aggregateMonthly("2026-09", [
      row({ day: "2026-09-01", work_hours: 7.75, status: "present" }),
      row({ day: "2026-09-02", work_hours: 8.92, status: "late" }),
      row({ day: "2026-09-03", work_hours: null, status: "present", check_out: null }),
    ]);
    expect(s.completedDays).toBe(2);
    expect(s.incompleteDays).toBe(1);
    expect(s.totalWorkMinutes).toBe(465 + 535);
    // (465 + 535) / 2 = 500m = 8h 20m. The incomplete day is excluded.
    expect(s.averageWorkMinutes).toBe(500);
  });

  it("a completed day with no stored duration does not drag the average down", () => {
    // A legacy row with both timestamps but no computed work hours must not sit
    // in the divisor while contributing 0 to the total.
    const s = aggregateMonthly("2026-09", [
      row({ day: "2026-09-01", work_minutes: 480 }),
      row({ day: "2026-09-02", work_minutes: 480 }),
      row({ day: "2026-09-03", work_minutes: null, work_hours: null }),
    ]);
    expect(s.completedDays).toBe(3);
    expect(s.completedDaysWithHours).toBe(2);
    expect(s.totalWorkMinutes).toBe(960);
    expect(s.averageWorkMinutes).toBe(480);
  });

  it("counts present, late, half-day and absent days by status", () => {
    const s = aggregateMonthly("2026-09", [
      row({ day: "2026-09-01", status: "present" }),
      row({ day: "2026-09-02", status: "present" }),
      row({ day: "2026-09-03", status: "late" }),
      row({ day: "2026-09-04", status: "half_day" }),
      row({ day: "2026-09-05", status: "absent", check_in: null, check_out: null }),
    ]);
    expect(s.presentDays).toBe(2);
    expect(s.lateDays).toBe(1);
    expect(s.halfDays).toBe(1);
    expect(s.absentDays).toBe(1);
    expect(s.totalRecords).toBe(5);
  });

  it("counts early/late logins and logouts as days, not minutes", () => {
    const s = aggregateMonthly("2026-09", [
      row({ day: "2026-09-01", early_login_minutes: 15 }),
      row({ day: "2026-09-02", early_login_minutes: 30, late_minutes: 5 }),
      row({ day: "2026-09-03", late_minutes: 45 }),
      row({ day: "2026-09-04", early_departure_minutes: 30 }),
      row({ day: "2026-09-05", late_logout_minutes: 60, early_departure_minutes: 10 }),
      row({ day: "2026-09-06" }),
    ]);
    expect(s.earlyLoginCount).toBe(2);
    expect(s.lateLoginCount).toBe(2);
    expect(s.earlyLogoutCount).toBe(2);
    expect(s.lateLogoutCount).toBe(1);
  });

  it("totals overtime from completed days only", () => {
    const s = aggregateMonthly("2026-09", [
      row({ day: "2026-09-01", overtime_minutes: 60 }),
      row({ day: "2026-09-02", overtime_minutes: 30 }),
      // Incomplete day: any stored overtime is ignored.
      row({ day: "2026-09-03", overtime_minutes: 90, check_out: null, work_hours: null }),
    ]);
    expect(s.totalOvertimeMinutes).toBe(90);
  });

  it("treats a missing check-out as incomplete, never as a completed day", () => {
    const s = aggregateMonthly("2026-09", [
      row({ day: "2026-09-01", check_out: null, work_hours: null }),
    ]);
    expect(s.incompleteDays).toBe(1);
    expect(s.completedDays).toBe(0);
    expect(s.totalWorkMinutes).toBe(0);
    expect(s.averageWorkMinutes).toBe(0);
  });

  it("returns zeroes for an empty month instead of dividing by zero", () => {
    const s = aggregateMonthly("2026-09", []);
    expect(s.totalRecords).toBe(0);
    expect(s.averageWorkMinutes).toBe(0);
    expect(Number.isFinite(s.averageWorkMinutes)).toBe(true);
  });

  it("aggregates a mixed month end to end", () => {
    // Four GEN days: normal, early login + early logout, overtime, incomplete.
    const days = [
      metrics(GEN, "09:00", "18:00"),
      metrics(GEN, "08:30", "17:00"),
      metrics(GEN, "09:00", "19:00"),
      metrics(GEN, "09:00", null),
    ];
    const s = aggregateMonthly(
      "2026-09",
      days.map((m, i) => ({
        work_date: `2026-09-0${i + 1}`,
        check_in: `2026-09-0${i + 1}T09:00:00+00:00`,
        check_out: m.work_hours == null ? null : `2026-09-0${i + 1}T19:00:00+00:00`,
        status: m.status,
        late_minutes: m.late_minutes,
        early_login_minutes: m.early_login_minutes,
        overtime_minutes: m.overtime_minutes,
        late_logout_minutes: m.late_logout_minutes,
        early_departure_minutes: m.early_departure_minutes,
        work_minutes: m.work_minutes,
        work_hours: m.work_hours,
      })),
    );
    expect(s.totalRecords).toBe(4);
    expect(s.completedDays).toBe(3);
    expect(s.completedDaysWithHours).toBe(3);
    expect(s.incompleteDays).toBe(1);
    // 480m + 450m + 540m = 1470m over 3 completed days = 490m average.
    expect(s.totalWorkMinutes).toBe(1470);
    expect(s.averageWorkMinutes).toBe(490);
    expect(s.totalOvertimeMinutes).toBe(60);
    expect(s.earlyLoginCount).toBe(1);
    expect(s.earlyLogoutCount).toBe(1);
    expect(s.lateLogoutCount).toBe(1);
  });

  it("reads durations from work_minutes, not the rounded work_hours column", () => {
    // 464m = 7h 44m. Rounded to 2dp that is 7.73h = 464m, but a value such as
    // 7.74h would be 464.4m: only the integer column is truly exact.
    const s = aggregateMonthly("2026-09", [
      row({ day: "2026-09-01", work_minutes: 464, work_hours: 7.74 }),
      row({ day: "2026-09-02", work_minutes: 466, work_hours: 7.77 }),
    ]);
    expect(s.totalWorkMinutes).toBe(930);
    expect(s.averageWorkMinutes).toBe(465);
  });

  it("falls back to legacy work_hours when work_minutes is null", () => {
    const s = aggregateMonthly("2026-09", [
      row({ day: "2026-09-01", work_minutes: null, work_hours: 7.75 }),
    ]);
    expect(s.completedDaysWithHours).toBe(1);
    expect(s.totalWorkMinutes).toBe(465);
  });

  it("excludes a completed day with no duration from the average divisor", () => {
    const s = aggregateMonthly("2026-09", [
      row({ day: "2026-09-01", work_minutes: 480 }),
      row({ day: "2026-09-02", work_minutes: null, work_hours: null }),
    ]);
    expect(s.completedDays).toBe(2);
    expect(s.completedDaysWithHours).toBe(1);
    expect(s.averageWorkMinutes).toBe(480);
  });
});

describe("device-local conversion on a non-UTC host", () => {
  // Regression: the server runs with Django on UTC but the host clock on IST
  // (UTC+5:30). `localMinutesAt` already adds the device offset to the instant,
  // so reading it back with the *local* getters applied the host offset a
  // second time. A 09:00-shift check-in at device-local 11:34 was reported as
  // 1024 minutes (17:04) -> 454 late, instead of 694 (11:34) -> 124 late.
  const ORIGINAL_TZ = process.env["TZ"];
  const IST = "Asia/Kolkata";

  it("reconstructs the device wall clock, not the host's", () => {
    process.env["TZ"] = IST;
    try {
      // Stored instants from the real browser run; the client reported 11:35:43.
      const checkInIso = "2026-09-30T06:04:53.653Z"; // 11:34:53 device-local
      const checkOutIso = "2026-09-30T06:05:43.153Z"; // 11:35:43 device-local
      const refLocalTime = "11:35:43";

      expect(localMinutesAt(checkInIso, refLocalTime, checkOutIso)).toBe(11 * 60 + 34);
      // The device offset is derived from a minute-precision client string, so
      // the seconds carry a sub-minute skew; the wall-clock hour/minute is the
      // invariant that matters (11:34 device-local, not the host's 17:04).
      expect(localDateTimeAt(checkInIso, refLocalTime, checkOutIso)).toMatch(/^2026-09-30 11:34:/);
    } finally {
      process.env["TZ"] = ORIGINAL_TZ;
    }
  });

  it("keeps a shift-relative late count stable on UTC and IST hosts", () => {
    // GEN is the 09:00 / 30m-grace shift the assignment in the browser run used.
    const late = (tz: string) => {
      process.env["TZ"] = tz;
      const checkInIso = "2026-09-30T06:04:53.653Z";
      const checkOutIso = "2026-09-30T06:05:43.153Z";
      const refLocalTime = "11:35:43";
      const cin = localMinutesAt(checkInIso, refLocalTime, checkOutIso);
      const pad2 = (n: number) => String(n).padStart(2, "0");
      return computeMetrics({
        shift: GEN as never,
        localDate: "2026-09-30",
        localCheckIn: `${pad2(Math.floor(cin / 60))}:${pad2(cin % 60)}`,
        localCheckOut: localDateTimeAt(checkOutIso, refLocalTime, checkOutIso),
        checkInIso,
        checkOutIso,
      }).late_minutes;
    };
    try {
      // 11:34 against a 09:00 start with 30m grace = 124 late, on either host.
      expect(late("UTC")).toBe(124);
      expect(late(IST)).toBe(124);
    } finally {
      process.env["TZ"] = ORIGINAL_TZ;
    }
  });
});
