import { describe, expect, it } from "vitest";

import { computeMetrics } from "./attendance.functions";
import {
  aggregateOvertime,
  classifyDay,
  normalizeScheduledDays,
  weekStartDate,
  type OvertimeContext,
  type OvertimeShift,
} from "./overtime";

/** Minimal shift shape; `days_of_week` absent falls back to the Mon-Fri default. */
function shift(
  over: Partial<NonNullable<OvertimeShift>> & { grace_minutes?: number } = {},
): OvertimeShift {
  return {
    start_time: "09:00:00",
    end_time: "18:00:00",
    break_minutes: 60,
    grace_minutes: 30,
    overtime_after_minutes: 30,
    weekly_overtime_after_minutes: 0,
    overnight: false,
    days_of_week: [1, 2, 3, 4, 5],
    ...over,
  };
}

const MON = "2026-09-07";
const TUE = "2026-09-08";
const WED = "2026-09-09";
const THU = "2026-09-10";
const FRI = "2026-09-11";
const SAT = "2026-09-12";
const SUN = "2026-09-13";

function at(time: string, day = MON) {
  return `${day}T${time.slice(0, 5)}:00.000Z`;
}

function metrics(
  s: OvertimeShift,
  cin: string,
  cout: string,
  day = MON,
  holidays: ReadonlySet<string> = new Set(),
) {
  return computeMetrics({
    shift: s as never,
    localDate: day,
    localCheckIn: cin,
    localCheckOut: cout,
    checkInIso: at(cin, day),
    checkOutIso: at(cout, day),
    holidays,
  });
}

function record(day: string, net: number, ot: number, employeeId = "e1") {
  return {
    employee_id: employeeId,
    work_date: day,
    check_in: `${day}T09:00:00+00:00`,
    check_out: `${day}T18:00:00+00:00`,
    work_minutes: net,
    work_hours: net / 60,
    overtime_minutes: ot,
  };
}

const contextFor =
  (s: OvertimeShift, holidays: ReadonlySet<string> = new Set()): OvertimeContext =>
  () => ({ shift: s, holidays });

const noHolidays: OvertimeContext = () => ({ shift: null, holidays: new Set() });

describe("scheduled days and the week window", () => {
  it("normalizes the legacy zero-based convention when 0 is present", () => {
    expect(normalizeScheduledDays([0, 1, 2, 3, 4])).toEqual([0, 1, 2, 3, 4]);
    expect(normalizeScheduledDays([0, 1, 2, 3, 4, 5, 6])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("normalizes the current one-based convention (1=Mon .. 7=Sun)", () => {
    expect(normalizeScheduledDays([1, 2, 3, 4, 5])).toEqual([0, 1, 2, 3, 4]);
    expect(normalizeScheduledDays([1, 2, 3, 4, 5, 6, 7])).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(normalizeScheduledDays([6, 7])).toEqual([5, 6]);
  });

  it("falls back to Mon-Fri for an empty or unset schedule", () => {
    expect(normalizeScheduledDays([])).toEqual([0, 1, 2, 3, 4]);
    expect(normalizeScheduledDays(null)).toEqual([0, 1, 2, 3, 4]);
    expect(normalizeScheduledDays(undefined)).toEqual([0, 1, 2, 3, 4]);
  });

  it("resolves the Monday of the week for a range of dates", () => {
    expect(weekStartDate("2026-09-07")).toBe("2026-09-07");
    expect(weekStartDate("2026-09-12")).toBe("2026-09-07");
    expect(weekStartDate("2026-09-13")).toBe("2026-09-07");
    expect(weekStartDate("2026-09-14")).toBe("2026-09-14");
  });
});

describe("canonical 1-based days_of_week (1=Mon .. 7=Sun)", () => {
  it("maps each canonical value to its Monday-first weekday", () => {
    expect(normalizeScheduledDays([1])).toEqual([0]); // Monday
    expect(normalizeScheduledDays([2])).toEqual([1]); // Tuesday
    expect(normalizeScheduledDays([3])).toEqual([2]); // Wednesday
    expect(normalizeScheduledDays([4])).toEqual([3]); // Thursday
    expect(normalizeScheduledDays([5])).toEqual([4]); // Friday
    expect(normalizeScheduledDays([6])).toEqual([5]); // Saturday
    expect(normalizeScheduledDays([7])).toEqual([6]); // Sunday
  });

  it("General remains Mon-Fri after canonicalization", () => {
    const days = normalizeScheduledDays([1, 2, 3, 4, 5]);
    expect(days).toEqual([0, 1, 2, 3, 4]);
    expect(days).toHaveLength(5);
  });

  it("Night Shift remains Mon-Sat after canonicalization", () => {
    const days = normalizeScheduledDays([1, 2, 3, 4, 5, 6]);
    expect(days).toEqual([0, 1, 2, 3, 4, 5]);
    expect(days).toHaveLength(6);
    expect(days).not.toContain(6); // Sunday must not be added
    expect(days).toContain(5); // Saturday must not be removed
  });

  it("a canonical Mon-Sat shift keeps Saturday scheduled and Sunday a rest day", () => {
    const s = shift({ days_of_week: [1, 2, 3, 4, 5, 6] });
    expect(
      classifyDay({ workDate: SAT, netMinutes: 540, shift: s, holidays: new Set() }).bucket,
    ).toBe("daily");
    expect(
      classifyDay({ workDate: SUN, netMinutes: 540, shift: s, holidays: new Set() }).bucket,
    ).toBe("weekend");
  });

  it("legacy 0-based normalization still behaves correctly", () => {
    expect(normalizeScheduledDays([0, 1, 2, 3, 4])).toEqual([0, 1, 2, 3, 4]);
    expect(normalizeScheduledDays([0, 1, 2, 3, 4, 5, 6])).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("daily overtime qualification", () => {
  it("qualifies only after net time exceeds required hours by more than the threshold", () => {
    const s = shift({ overtime_after_minutes: 30 });
    // Threshold test set: required 480m (9h span, 1h break), threshold 30m.
    // 480 -> 0 (worked exactly the required hours)
    expect(metrics(s, "09:00", "18:00").overtime_minutes).toBe(0);
    // 500 -> 0 (20m excess is within the 30m threshold)
    expect(metrics(s, "09:00", "18:20").overtime_minutes).toBe(0);
    // 510 -> 0 (30m excess equals the threshold, does not qualify)
    expect(metrics(s, "09:00", "18:30").overtime_minutes).toBe(0);
    // 511 -> 31 (30m + 1m excess qualifies; the threshold is not subtracted)
    expect(metrics(s, "09:00", "18:31").overtime_minutes).toBe(31);
    // 540 -> 60 with a 30m threshold
    expect(metrics(s, "09:00", "19:00").overtime_minutes).toBe(60);
  });

  it("a zero threshold treats any excess as overtime", () => {
    const s = shift({ break_minutes: 0, overtime_after_minutes: 0 });
    // 540 - 480 = 60, threshold 0 -> 60.
    expect(metrics(s, "09:00", "19:00").overtime_minutes).toBe(60);
  });

  it("the threshold is never subtracted from the qualifying excess", () => {
    const s = shift({ overtime_after_minutes: 30 });
    expect(metrics(s, "09:00", "18:31").overtime_minutes).toBe(31);
    const m = metrics(s, "09:00", "19:00");
    expect(m.work_minutes).toBe(540);
    expect(m.overtime_minutes).toBe(60);
    expect(m.overtime_minutes).toBe(540 - 480);
  });

  it("the unpaid break is deducted before qualification", () => {
    const s = shift({ overtime_after_minutes: 30 });
    // 09:00 -> 19:00 is 600m elapsed, 540m net after the 60m break.
    expect(metrics(s, "09:00", "19:00").work_minutes).toBe(540);
    expect(metrics(s, "09:00", "19:00").overtime_minutes).toBe(60);
  });

  it("an overnight shift measures net time the same way", () => {
    const night = shift({
      start_time: "22:00:00",
      end_time: "08:00:00",
      break_minutes: 60,
      overtime_after_minutes: 30,
      overnight: true,
    });
    // 22:00 -> 08:00 next day = 600m elapsed, 540m net, exactly the required time.
    const exact = computeMetrics({
      shift: night as never,
      localDate: MON,
      localCheckIn: "22:00:00",
      localCheckOut: "08:00:00",
      checkInIso: at("22:00", MON),
      checkOutIso: at("08:00", TUE),
    });
    expect(exact.work_minutes).toBe(540);
    expect(exact.overtime_minutes).toBe(0);

    // 22:00 -> 09:00 next day = 660m elapsed, 600m net, 60m beyond required.
    const over = computeMetrics({
      shift: night as never,
      localDate: MON,
      localCheckIn: "22:00:00",
      localCheckOut: "09:00:00",
      checkInIso: at("22:00", MON),
      checkOutIso: at("09:00", TUE),
    });
    expect(over.work_minutes).toBe(600);
    expect(over.overtime_minutes).toBe(60);
  });
});

describe("weekend and holiday overtime", () => {
  it("a scheduled day is daily overtime; a rest day is weekend overtime", () => {
    // 540m net on a scheduled Monday exceeds the 480m required by 60m.
    const week = metrics(shift({}), "09:00", "19:00", MON);
    expect(week.overtime_minutes).toBe(60);
    // The full net time on a Saturday rest day is weekend overtime.
    const weekend = metrics(shift({ break_minutes: 0 }), "09:00", "18:00", SAT);
    expect(weekend.work_minutes).toBe(540);
    expect(weekend.overtime_minutes).toBe(540);
  });

  it("classifies weekend, holiday and daily days into their own buckets", () => {
    const rest = shift({ break_minutes: 0 });
    const daily = shift({});
    expect(
      classifyDay({ workDate: SAT, netMinutes: 540, shift: rest, holidays: new Set() }).bucket,
    ).toBe("weekend");
    expect(
      classifyDay({ workDate: MON, netMinutes: 540, shift: rest, holidays: new Set([MON]) }).bucket,
    ).toBe("holiday");
    expect(
      classifyDay({ workDate: MON, netMinutes: 540, shift: daily, holidays: new Set() }).bucket,
    ).toBe("daily");
  });

  it("a company holiday pays the whole shift as overtime, even on a scheduled day", () => {
    const s = shift({ break_minutes: 0, overtime_after_minutes: 30 });
    const holidays = new Set([MON]);
    const m = metrics(s, "09:00", "18:00", MON, holidays);
    expect(m.work_minutes).toBe(540);
    expect(m.overtime_minutes).toBe(540);
  });
});

describe("weekly overtime with double-count protection", () => {
  it("pays the week excess once, not per day plus per week", () => {
    // Mon-Thu 480m net (0 daily OT), Friday 600m (120m daily OT).
    // Required 480 x 5 = 2400m; worked 2520m -> 120m weekly OT.
    const s = shift({});
    const context = contextFor(s);
    const records = [
      record(MON, 480, 0),
      record(TUE, 480, 0),
      record(WED, 480, 0),
      record(THU, 480, 0),
      record(FRI, 600, 120),
    ];
    const b = aggregateOvertime(records, context);
    expect(b.weeklyOvertimeMinutes).toBe(120);
    expect(b.dailyOvertimeMinutes).toBe(120);
    // The weekly OT and the Friday daily OT are the same 120 minutes.
    expect(b.totalOvertimeMinutes).toBe(120);
    expect(b.totalOvertimeMinutes).toBeLessThan(240);
  });

  it("attaches the weekly-only minutes on the day they were worked", () => {
    const s = shift({});
    const b = aggregateOvertime(
      [
        record(MON, 480, 0),
        record(TUE, 480, 0),
        record(WED, 480, 0),
        record(THU, 480, 0),
        record(FRI, 600, 120),
      ],
      contextFor(s),
    );
    const friday = b.days.find((d) => d.workDate === FRI)!;
    expect(friday.dailyOvertimeMinutes).toBe(120);
    expect(friday.weeklyOvertimeMinutes).toBe(120);
    expect(friday.totalOvertimeMinutes).toBe(120);
    expect(friday.regularMinutes).toBe(600 - 120);
    expect(b.regularMinutes).toBe(480 * 4 + 480);
  });

  it("a spread surplus that never qualifies per day still counts weekly", () => {
    // 15m over every day (excess 15 < threshold 30 -> no daily OT), 75m of
    // weekly surplus.
    const s = shift({ overtime_after_minutes: 30 });
    const records = [MON, TUE, WED, THU, FRI].map((day) => record(day, 495, 0));
    const b = aggregateOvertime(records, contextFor(s));
    expect(b.weeklyOvertimeMinutes).toBe(75);
    expect(b.dailyOvertimeMinutes).toBe(0);
    // The breakdown total is the union, not daily + weekly stacked.
    expect(b.totalOvertimeMinutes).toBe(75);
  });

  it("respects the weekly_overtime_after_minutes qualification threshold", () => {
    // 2520m worked, 2400m required. Weekly threshold 30m -> excess 120 qualifies.
    const qualifying = shift({ weekly_overtime_after_minutes: 30 });
    const b = aggregateOvertime(
      [
        record(MON, 480, 0),
        record(TUE, 480, 0),
        record(WED, 480, 0),
        record(THU, 480, 0),
        record(FRI, 600, 120),
      ],
      contextFor(qualifying),
    );
    expect(b.weeklyOvertimeMinutes).toBe(120);

    // Worked 2430m (weekly excess 30m), threshold 30m -> does not qualify.
    const noQualify = shift({ weekly_overtime_after_minutes: 30 });
    const c = aggregateOvertime(
      [
        record(MON, 480, 0),
        record(TUE, 480, 0),
        record(WED, 480, 0),
        record(THU, 480, 0),
        record(FRI, 510, 0),
      ],
      contextFor(noQualify),
    );
    expect(c.weeklyOvertimeMinutes).toBe(0);
  });

  it("a weekend day's overtime and the weekly surplus are not double counted", () => {
    // Friday 480 + Saturday rest day 300 (all weekend OT): total 780m.
    // Required 2400m -> no weekly surplus (780 < 2400).
    const s = shift({});
    const b = aggregateOvertime([record(FRI, 480, 0), record(SAT, 300, 300)], contextFor(s));
    expect(b.weekendOvertimeMinutes).toBe(300);
    expect(b.weeklyOvertimeMinutes).toBe(0);
    expect(b.totalOvertimeMinutes).toBe(300);
  });

  it("classifies stored holiday minutes into the holiday bucket", () => {
    const s = shift({});
    const b = aggregateOvertime(
      [record(MON, 480, 480), record(FRI, 480, 0)],
      contextFor(s, new Set([MON])),
    );
    expect(b.holidayOvertimeMinutes).toBe(480);
    expect(b.dailyOvertimeMinutes).toBe(0);
    expect(b.totalOvertimeMinutes).toBe(480);
  });

  it("aggregates per employee, not across employees", () => {
    const s = shift({});
    const records = [
      record(MON, 480, 0, "e1"),
      record(FRI, 600, 120, "e1"),
      record(MON, 600, 120, "e2"),
    ];
    const b = aggregateOvertime(records, contextFor(s));
    // e1: 480x5 required? No: e1 has only two days (1080m) and e2 a partial week.
    // Per-employee weeks never stack, so the weekly surplus is per employee week.
    expect(b.totalOvertimeMinutes).toBe(120 + 120);
  });

  it("ignores incomplete records entirely", () => {
    const s = shift({});
    const records = [
      { ...record(MON, 480, 0), check_out: null, overtime_minutes: 90 },
      record(WED, 480, 0),
    ];
    const b = aggregateOvertime(records, noHolidays);
    expect(b.completedDays).toBe(1);
    expect(b.totalOvertimeMinutes).toBe(0);
  });

  it("returns zeroes for an empty set of records", () => {
    const b = aggregateOvertime([], noHolidays);
    expect(b.completedDays).toBe(0);
    expect(b.totalOvertimeMinutes).toBe(0);
    expect(b.regularMinutes).toBe(0);
    expect(b.days).toEqual([]);
  });
});
