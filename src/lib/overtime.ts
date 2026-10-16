import type { Database } from "@/integrations/supabase/types";

type ShiftRow = Database["public"]["Tables"]["shifts"]["Row"];

/**
 * The subset of a shift row the overtime rules need. Accepts a full `ShiftRow`
 * (the authoritative daily calculator passes it straight through) or a minimal
 * fixture in tests.
 */
export type OvertimeShift = null | Pick<
  ShiftRow,
  | "start_time"
  | "end_time"
  | "break_minutes"
  | "overnight"
  | "overtime_after_minutes"
  | "weekly_overtime_after_minutes"
  | "days_of_week"
>;

export type DayOvertimeBucket = "none" | "daily" | "weekend" | "holiday";

/** A stored attendance row in the shape the aggregation reads. */
export type OvertimeRecord = {
  employee_id: string | null;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  work_minutes?: number | null;
  work_hours?: number | null;
  overtime_minutes?: number | null;
};

/** Resolves the active shift and applicable holidays for one employee. */
export type OvertimeContext = (employeeId: string | null | undefined) => {
  shift: OvertimeShift;
  holidays: ReadonlySet<string>;
};

export type OvertimeDayResult = {
  workDate: string;
  regularMinutes: number;
  dailyOvertimeMinutes: number;
  weeklyOvertimeMinutes: number;
  weekendOvertimeMinutes: number;
  holidayOvertimeMinutes: number;
  totalOvertimeMinutes: number;
};

export type OvertimeBreakdown = Omit<OvertimeDayResult, "workDate"> & {
  completedDays: number;
  days: OvertimeDayResult[];
};

const DEFAULT_SCHEDULED_DAYS = [0, 1, 2, 3, 4];

const toMinutes = (t: string) => {
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/**
 * Normalize a shift's `days_of_week` to a Monday-first weekday set
 * (`0`=Mon .. `6`=Sun).
 *
 * The canonical, documented convention is 1-based Monday-first (`1`=Mon ..
 * `7`=Sun); the UI writes it and the database stores it (see data migration
 * `0008_shift_days_of_week_canonical`, which canonicalized the legacy 0-based
 * seeds). The branch below is retained as a defensive fallback: a value of `0`
 * signalled the legacy Monday-first 0-based convention (`0`=Mon .. `6`=Sun)
 * used by old seeds, otherwise the current 1-based convention applies. An
 * empty array falls back to the documented default schedule of Mon-Fri.
 */
export function normalizeScheduledDays(days: readonly number[] | null | undefined): number[] {
  if (!days || days.length === 0) return [...DEFAULT_SCHEDULED_DAYS];
  const base = days.includes(0) ? 0 : 1;
  const out = new Set<number>();
  for (const d of days) {
    const v = d - base;
    if (v >= 0 && v <= 6) out.add(v);
  }
  if (out.size === 0) return [...DEFAULT_SCHEDULED_DAYS];
  return [...out].sort((a, b) => a - b);
}

/** Weekday of a `YYYY-MM-DD` work date in the Monday-first convention (`0`=Mon .. `6`=Sun). */
export function isoWeekday(workDate: string): number {
  const [y, m, d] = workDate.split("-").map(Number);
  const day = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return (day + 6) % 7;
}

/** Monday of the ISO week containing the `YYYY-MM-DD` date, as `YYYY-MM-DD`. */
export function weekStartDate(workDate: string): string {
  const [y, m, d] = workDate.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function isRestDay(shift: OvertimeShift, workDate: string): boolean {
  return !normalizeScheduledDays(shift?.days_of_week).includes(isoWeekday(workDate));
}

/** Configured net working minutes per scheduled day: shift clock span less the unpaid break. */
export function scheduledNetMinutes(shift: OvertimeShift): number {
  if (!shift) return 0;
  const start = toMinutes(shift.start_time);
  const end = toMinutes(shift.end_time);
  const overnight = shift.overnight || end < start;
  const span = Math.max(0, (overnight ? 1440 : 0) + end - start);
  return Math.max(0, span - (shift.break_minutes ?? 0));
}

/** Configured scheduled net minutes for a full week, i.e. required hours for the week. */
export function weeklyRequiredMinutes(shift: OvertimeShift): number {
  if (!shift) return 0;
  return scheduledNetMinutes(shift) * normalizeScheduledDays(shift.days_of_week).length;
}

/**
 * Classify one completed working day and compute its overtime.
 *
 * Rules (the single authoritative classification, shared by the daily
 * calculator, the aggregation and the UI):
 * - a holiday the employee is off on pays the entire net time as overtime;
 * - a non-scheduled day (rest day / weekend) pays the entire net time as overtime;
 * - a scheduled day pays only the net time beyond the shift's required hours,
 *   and only once the excess exceeds the shift's qualification threshold
 *   (`overtime_after_minutes`). The threshold qualifies but is never subtracted.
 */
export function classifyDay(input: {
  workDate: string;
  netMinutes: number;
  shift: OvertimeShift;
  holidays: ReadonlySet<string>;
}): { bucket: DayOvertimeBucket; overtimeMinutes: number; regularMinutes: number } {
  const net = Math.max(0, input.netMinutes);
  if (net === 0) return { bucket: "none", overtimeMinutes: 0, regularMinutes: 0 };

  if (input.holidays.has(input.workDate)) {
    return { bucket: "holiday", overtimeMinutes: net, regularMinutes: 0 };
  }

  if (isRestDay(input.shift, input.workDate)) {
    return { bucket: "weekend", overtimeMinutes: net, regularMinutes: 0 };
  }

  if (!input.shift) return { bucket: "none", overtimeMinutes: 0, regularMinutes: net };

  const required = scheduledNetMinutes(input.shift);
  const after = input.shift.overtime_after_minutes ?? 0;
  const excess = net - required;
  const overtime = excess > after ? excess : 0;
  return {
    bucket: overtime > 0 ? "daily" : "none",
    overtimeMinutes: overtime,
    regularMinutes: net - overtime,
  };
}

/** Shared empty holiday set; fast path when a caller has no holiday context. */
export const NO_HOLIDAYS: ReadonlySet<string> = new Set();

const emptyDay = (workDate: string): OvertimeDayResult => ({
  workDate,
  regularMinutes: 0,
  dailyOvertimeMinutes: 0,
  weeklyOvertimeMinutes: 0,
  weekendOvertimeMinutes: 0,
  holidayOvertimeMinutes: 0,
  totalOvertimeMinutes: 0,
});

/**
 * Aggregate overtime across stored attendance rows for a period, per employee.
 *
 * The day-level overtime amount always comes from the persisted, authoritative
 * `overtime_minutes` column (what the daily calculator wrote at check-out), so
 * the breakdown's day totals agree with the records table. The *cause* of that
 * overtime (`daily`/`weekend`/`holiday`) and the weekly component are derived
 * from the employee's current schedule, because those are contextual.
 *
 * Weekly overtime is quantified against the configured weekly required minutes
 * (`scheduled net per day x scheduled days`), qualified by the shift's
 * `weekly_overtime_after_minutes`. To prevent double counting, the payable
 * total is the size of a minute-interval union per ISO week: each week's raw
 * weekly overtime is treated as a suffix of the concatenated week, and its
 * overlap with the day-level overtime intervals is counted once.
 */
export function aggregateOvertime(
  records: OvertimeRecord[],
  context: OvertimeContext,
): OvertimeBreakdown {
  const totals: OvertimeBreakdown = {
    completedDays: 0,
    regularMinutes: 0,
    dailyOvertimeMinutes: 0,
    weeklyOvertimeMinutes: 0,
    weekendOvertimeMinutes: 0,
    holidayOvertimeMinutes: 0,
    totalOvertimeMinutes: 0,
    days: [],
  };

  type WeekDay = {
    record: OvertimeRecord;
    net: number;
    offset: number;
  };
  type WeekGroup = {
    monday: string;
    days: WeekDay[];
  };

  const groups = new Map<string, WeekGroup>();

  for (const r of records) {
    if (!r.check_in || !r.check_out) continue;
    totals.completedDays += 1;
    const net = Math.max(
      0,
      r.work_minutes ?? (r.work_hours != null ? Math.round(r.work_hours * 60) : 0),
    );
    if (net === 0) continue;

    const monday = weekStartDate(r.work_date);
    const key = `${r.employee_id ?? ""}|${monday}`;
    const group = groups.get(key) ?? { monday, days: [] };
    group.days.push({ record: r, net, offset: 0 });
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.days.sort((a, b) => (a.record.work_date < b.record.work_date ? -1 : 1));
    let offset = 0;
    for (const day of group.days) {
      day.offset = offset;
      offset += day.net;
    }
    const totalNet = offset;

    // Weekly overtime is quantified only when the employee has an assigned
    // shift; without one the required week is unknown, so nothing qualifies.
    const lastShift = context(group.days[group.days.length - 1]?.record.employee_id)?.shift ?? null;
    const required = lastShift ? weeklyRequiredMinutes(lastShift) : 0;
    const after = lastShift?.weekly_overtime_after_minutes ?? 0;
    const weeklyRaw = lastShift && totalNet > required + after ? totalNet - required : 0;

    // The weekly overtime is the last `weeklyRaw` minutes of the concatenated
    // week (the minutes worked beyond the required week).
    const globalStart = totalNet - weeklyRaw;

    for (const day of group.days) {
      const { work_date: workDate, overtime_minutes: storedOvertime } = day.record;
      const dayShift = context(day.record.employee_id)?.shift ?? null;
      const holidays = context(day.record.employee_id)?.holidays ?? NO_HOLIDAYS;

      const classified = classifyDay({ workDate, netMinutes: day.net, shift: dayShift, holidays });
      let bucket = classified.bucket;
      const dayOvertime = Math.min(
        Math.max(0, storedOvertime ?? classified.overtimeMinutes),
        day.net,
      );
      // Legacy rows may carry overtime on a day the current schedule does not
      // classify as overtime; keep the stored figure attributed to the daily
      // bucket so the breakdown stays consistent with the records table.
      if (bucket === "none" && dayOvertime > 0) bucket = "daily";

      // Day-level overtime interval (local to the day): the tail of the day for
      // scheduled-day overtime, the entire day for weekend/holiday work.
      const dLo = dayOvertime === 0 ? 0 : bucket === "daily" ? day.net - dayOvertime : 0;
      const dHi = dayOvertime === 0 ? 0 : bucket === "daily" ? day.net : dayOvertime;

      // Weekly suffix restricted to this day (local). Clamped to [0, net).
      const wLo = Math.max(0, globalStart - day.offset);
      const wHi = Math.min(day.net, totalNet - day.offset);
      const wLen = Math.max(0, wHi - wLo);

      // Union of the two intervals inside the day: sum of sizes less the overlap.
      const overlap = Math.max(0, Math.min(dHi, wHi) - Math.max(dLo, wLo));
      const dayTotal = dayOvertime + wLen - overlap;

      totals.regularMinutes += day.net - dayTotal;
      totals.dailyOvertimeMinutes += bucket === "daily" ? dayOvertime : 0;
      totals.weekendOvertimeMinutes += bucket === "weekend" ? dayOvertime : 0;
      totals.holidayOvertimeMinutes += bucket === "holiday" ? dayOvertime : 0;
      totals.weeklyOvertimeMinutes += wLen;
      totals.totalOvertimeMinutes += dayTotal;

      totals.days.push({
        workDate,
        regularMinutes: day.net - dayTotal,
        dailyOvertimeMinutes: bucket === "daily" ? dayOvertime : 0,
        weeklyOvertimeMinutes: wLen,
        weekendOvertimeMinutes: bucket === "weekend" ? dayOvertime : 0,
        holidayOvertimeMinutes: bucket === "holiday" ? dayOvertime : 0,
        totalOvertimeMinutes: dayTotal,
      });
    }
  }

  totals.days.sort((a, b) => (a.workDate < b.workDate ? -1 : 1));
  return totals;
}
