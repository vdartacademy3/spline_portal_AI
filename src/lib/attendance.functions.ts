import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { classifyDay, NO_HOLIDAYS, type OvertimeShift } from "@/lib/overtime";

type ShiftRow = Database["public"]["Tables"]["shifts"]["Row"];
type AttendanceRow = Database["public"]["Tables"]["attendance_records"]["Row"];

const toMinutes = (t: string) => {
  const sep = Math.max(t.lastIndexOf("T"), t.lastIndexOf(" "));
  const timePart = sep >= 0 ? t.slice(sep + 1) : t;
  const [hStr, mStr] = timePart.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

/** Two-decimal rounding, matching `work_hours DecimalField(max_digits=8, decimal_places=2)`. */
const round2 = (n: number) => Math.round(n * 100) / 100;

function dateDiffDays(fromIso: string, toIso: string) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const ms =
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) -
    Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  return ms / 86400000;
}

/** Device-local wall-clock minutes-of-day for a UTC instant (same frame as the client's `localTime`). */
export function localMinutesAt(iso: string, refLocalTime: string, refIso: string) {
  const ref = new Date(refIso);
  if (Number.isNaN(ref.getTime())) return toMinutes(refLocalTime ?? "");
  const refUtcMin =
    (ref.getTime() - Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())) / 60000;
  const deviceOffset = toMinutes(refLocalTime ?? "") - refUtcMin;
  const d = new Date(new Date(iso).getTime() + deviceOffset * 60000);
  if (Number.isNaN(d.getTime())) return 0;
  // Read the UTC fields: the device offset is already baked into `d`, so the
  // local getters would apply the host's own offset a second time (a server on
  // IST read 11:34 as 17:04 and reported 454 late minutes instead of 124).
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Device-local "YYYY-MM-DD HH:MM:SS" wall-clock string for a UTC instant (used for cross-day bounds). */
export function localDateTimeAt(iso: string, refLocalTime: string, refIso: string) {
  const ref = new Date(refIso);
  if (Number.isNaN(ref.getTime())) return iso;
  const refUtcMin =
    (ref.getTime() - Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate())) / 60000;
  const deviceOffset = toMinutes(refLocalTime ?? "") - refUtcMin;
  const d = new Date(new Date(iso).getTime() + deviceOffset * 60000);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  // UTC fields, for the same reason as `localMinutesAt`: the device offset is
  // already applied, so local getters would shift it by the host offset again.
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function computeMetrics({
  shift,
  localDate,
  localCheckIn,
  localCheckOut,
  checkInIso,
  checkOutIso,
  holidays,
}: {
  shift: ShiftRow | null;
  localDate: string;
  localCheckIn: string;
  localCheckOut: string | null;
  checkInIso: string;
  checkOutIso: string | null;
  /** Applicable holiday dates (`YYYY-MM-DD`) for this employee's organization. */
  holidays?: ReadonlySet<string>;
}) {
  const holidayDates = holidays ?? NO_HOLIDAYS;
  if (!shift) {
    if (!checkOutIso)
      return {
        late_minutes: 0,
        early_login_minutes: 0,
        overtime_minutes: 0,
        late_logout_minutes: 0,
        early_departure_minutes: 0,
        work_minutes: null,
        work_hours: null,
        is_half_day: false,
        status: "present" as const,
      };
    // No shift configured, so there is no break to deduct. A holiday or a
    // default rest day (Sat/Sun) still qualifies for overtime.
    const minutes = Math.max(
      0,
      Math.round((new Date(checkOutIso).getTime() - new Date(checkInIso).getTime()) / 60000),
    );
    const overtime = classifyDay({
      workDate: localDate,
      netMinutes: minutes,
      shift: null,
      holidays: holidayDates,
    }).overtimeMinutes;
    return {
      late_minutes: 0,
      early_login_minutes: 0,
      overtime_minutes: overtime,
      late_logout_minutes: 0,
      early_departure_minutes: 0,
      work_minutes: minutes,
      work_hours: round2(minutes / 60),
      is_half_day: false,
      status: minutes >= 480 ? ("present" as const) : ("early_departure" as const),
    };
  }

  const start = toMinutes(shift.start_time);
  const end = toMinutes(shift.end_time);
  const overnight = shift.overnight || end < start;
  const scheduledEnd = (overnight ? 1440 : 0) + end;
  const checkInMin = toMinutes(localCheckIn);
  const grace = shift.grace_minutes ?? 0;
  const breakMin = shift.break_minutes ?? 0;

  // Scheduled net working time: clock span of the shift less the configured
  // unpaid break, e.g. 09:00-18:00 with a 60m break -> 480m (8h).
  const late = Math.max(0, checkInMin - (start + grace));
  const earlyLogin = Math.max(0, start - checkInMin);

  if (!localCheckOut || !checkOutIso) {
    return {
      late_minutes: late,
      early_login_minutes: earlyLogin,
      overtime_minutes: 0,
      late_logout_minutes: 0,
      early_departure_minutes: 0,
      work_minutes: null,
      work_hours: null,
      is_half_day: false,
      status: "present" as const,
    };
  }

  // `localCheckOut` is a bare `HH:MM:SS` wall-clock string with no date, so the
  // day offset cannot come from it. Derive it from the ISO instants instead and
  // anchor it to the check-in wall clock, which keeps overnight shifts correct.
  //
  // The elapsed span is rounded to whole minutes once, here, because every
  // persisted metric is an integer-minute column. Everything downstream then
  // works in integers, so `work_minutes` is exact rather than 6-minute quantised.
  const rawMinutes = Math.round(
    (new Date(checkOutIso).getTime() - new Date(checkInIso).getTime()) / 60000,
  );
  const checkOutMin = toMinutes(localCheckIn) + rawMinutes;

  // Exact elapsed duration, with the configured unpaid break deducted once.
  // No rounding to fixed increments: 08:45 -> 17:30 less a 60m break is 465m (7h 45m).
  const workMinutes = Math.max(0, rawMinutes - breakMin);
  // `work_minutes` is the authoritative duration; `work_hours` is derived from
  // it and kept only for backward compatibility with decimal-hour consumers.
  const work_hours = round2(workMinutes / 60);

  const earlyDeparture = Math.max(0, scheduledEnd - checkOutMin);
  const lateLogout = Math.max(0, checkOutMin - scheduledEnd);
  // Overtime is computed by the shared classification rules: a holiday or a
  // non-scheduled (rest/weekend) day pays the whole net time, while a
  // scheduled day qualifies only once the net time exceeds the required hours
  // by more than the shift's threshold (`overtime_after_minutes`). The
  // threshold qualifies but is never subtracted: 480/30/511 -> 31m.
  const overtime = classifyDay({
    workDate: localDate,
    netMinutes: workMinutes,
    shift: shift as OvertimeShift,
    holidays: holidayDates,
  }).overtimeMinutes;

  const halfDayBoundary = (shift.half_day_hours ?? 4) * 60;
  const minimum = (shift.minimum_hours ?? 8) * 60;
  let status: AttendanceRow["status"];
  if (late > 0) status = "late";
  else if (workMinutes >= minimum) status = "present";
  else if (workMinutes <= halfDayBoundary) status = "half_day";
  else status = "early_departure";

  return {
    late_minutes: late,
    early_login_minutes: earlyLogin,
    overtime_minutes: overtime,
    late_logout_minutes: lateLogout,
    early_departure_minutes: earlyDeparture,
    work_minutes: workMinutes,
    work_hours,
    is_half_day: status === "half_day",
    status,
  };
}

/** Inclusive first/last calendar day of a `YYYY-MM` key. */
export function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/** The minimum shape `aggregateMonthly` needs; keeps it pure and unit-testable. */
export type MonthlyRecord = {
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  status: string | null;
  late_minutes: number | null;
  early_login_minutes: number | null;
  overtime_minutes: number | null;
  late_logout_minutes: number | null;
  early_departure_minutes: number | null;
  /** Authoritative net working minutes, after the shift break is deducted. */
  work_minutes: number | null;
  /** Legacy decimal hours, kept in sync with `work_minutes` for compatibility. */
  work_hours: number | null;
};

export type MonthlySummary = {
  month: string;
  start: string;
  end: string;
  /** Every attendance row stored for the month. */
  totalRecords: number;
  presentDays: number;
  lateDays: number;
  halfDays: number;
  absentDays: number;
  /** Checked in but never checked out. */
  incompleteDays: number;
  /** Days with both a check-in and a check-out. */
  completedDays: number;
  /**
   * Completed days that also carry a computed net working duration. This is the
   * divisor for the average: a completed day with no stored duration would
   * otherwise contribute 0 to the total while still inflating the count.
   */
  completedDaysWithHours: number;
  totalWorkMinutes: number;
  /** totalWorkMinutes / completedDays, exact to the minute. */
  averageWorkMinutes: number;
  totalOvertimeMinutes: number;
  earlyLoginCount: number;
  lateLoginCount: number;
  earlyLogoutCount: number;
  lateLogoutCount: number;
};

/**
 * Aggregate one month of attendance rows. Kept pure so the monthly figures are
 * derived from the rows actually stored for the month rather than from whatever
 * date range the page happens to have loaded.
 */
export function aggregateMonthly(month: string, rows: MonthlyRecord[]): MonthlySummary {
  const { start, end } = monthBounds(month);
  const summary: MonthlySummary = {
    month,
    start,
    end,
    totalRecords: rows.length,
    presentDays: 0,
    lateDays: 0,
    halfDays: 0,
    absentDays: 0,
    incompleteDays: 0,
    completedDays: 0,
    completedDaysWithHours: 0,
    totalWorkMinutes: 0,
    averageWorkMinutes: 0,
    totalOvertimeMinutes: 0,
    earlyLoginCount: 0,
    lateLoginCount: 0,
    earlyLogoutCount: 0,
    lateLogoutCount: 0,
  };

  for (const r of rows) {
    if (r.status === "present") summary.presentDays += 1;
    else if (r.status === "late") summary.lateDays += 1;
    else if (r.status === "half_day") summary.halfDays += 1;
    else if (r.status === "absent") summary.absentDays += 1;

    const hasIn = r.check_in != null;
    const hasOut = r.check_out != null;
    if (hasIn && !hasOut) summary.incompleteDays += 1;

    if (hasIn && hasOut) {
      summary.completedDays += 1;
      // `work_minutes` is authoritative. Fall back to the legacy decimal column
      // so rows written before the backfill still contribute their duration.
      const minutes =
        r.work_minutes ?? (r.work_hours != null ? Math.round(r.work_hours * 60) : null);
      if (minutes != null) {
        summary.totalWorkMinutes += minutes;
        summary.completedDaysWithHours += 1;
      }
      summary.totalOvertimeMinutes += r.overtime_minutes ?? 0;
    }

    if ((r.early_login_minutes ?? 0) > 0) summary.earlyLoginCount += 1;
    if ((r.late_minutes ?? 0) > 0) summary.lateLoginCount += 1;
    if ((r.early_departure_minutes ?? 0) > 0) summary.earlyLogoutCount += 1;
    if ((r.late_logout_minutes ?? 0) > 0) summary.lateLogoutCount += 1;
  }

  summary.averageWorkMinutes = summary.completedDaysWithHours
    ? Math.round(summary.totalWorkMinutes / summary.completedDaysWithHours)
    : 0;

  return summary;
}

async function callerEmployee(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("current_employee_id", {
    _user_id: context.userId,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

async function loadShift(db: any, employeeId: string, workDate: string): Promise<ShiftRow | null> {
  // The backend `or=(...)` filter is not AND-ed together with the other column
  // filters (see `hr/api/rest.py` `_collect_filters`), so it must not be combined
  // with `employee_id` here or the employee filter is dropped. Fetch the rows
  // that the column filters do handle and apply the effective window in code.
  const { data: assignments, error } = await db
    .from("employee_shift_assignments")
    .select("shift_id, effective_from, effective_to")
    .eq("employee_id", employeeId)
    .eq("is_active", true)
    .lte("effective_from", workDate)
    .order("effective_from", { ascending: false });
  if (error) throw error;

  const active = (
    (assignments ?? []) as {
      shift_id: string;
      effective_to?: string | null;
    }[]
  ).find((a) => a.effective_to == null || a.effective_to >= workDate);
  if (!active) return null;

  const { data: shift } = await db
    .from("shifts")
    .select("*")
    .eq("id", active.shift_id)
    .maybeSingle();
  return (shift as ShiftRow | null) ?? null;
}

const checkInSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkInIso: z.string(),
  localTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});

/** Employees check themselves in; the shift schedule (if any) drives late/status computation. */
export const checkIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => checkInSchema.parse(data))
  .handler(async ({ data, context }) => {
    const employeeId = await callerEmployee(context);
    if (!employeeId) throw new Error("No employee profile is linked to this account.");

    const serverDate = new Date().toISOString().slice(0, 10);
    if (Math.abs(dateDiffDays(data.workDate, serverDate)) > 1) {
      throw new Error("Check-in must be for today.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const shift = await loadShift(supabaseAdmin, employeeId, data.workDate);
    const { late_minutes, early_login_minutes, status } = computeMetrics({
      shift,
      localDate: data.workDate,
      localCheckIn: data.localTime,
      localCheckOut: null,
      checkInIso: data.checkInIso,
      checkOutIso: null,
    });

    const { data: row, error } = await supabaseAdmin
      .from("attendance_records")
      .upsert(
        {
          employee_id: employeeId,
          work_date: data.workDate,
          check_in: data.checkInIso,
          late_minutes,
          early_login_minutes: early_login_minutes,
          status,
          source: "self_check_in",
          updated_by: context.userId,
        },
        { onConflict: "employee_id,work_date" },
      )
      .select("id, check_in, check_out, status, late_minutes")
      .single();
    if (error) throw error;

    return { attendance: row as AttendanceRow };
  });

const checkOutSchema = checkInSchema.extend({
  checkOutIso: z.string(),
});

/** Employees check themselves out; work hours, overtime and early departure are computed from the shift. */
export const checkOut = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => checkOutSchema.parse(data))
  .handler(async ({ data, context }) => {
    const employeeId = await callerEmployee(context);
    if (!employeeId) throw new Error("No employee profile is linked to this account.");

    const serverDate = new Date().toISOString().slice(0, 10);
    if (Math.abs(dateDiffDays(data.workDate, serverDate)) > 1) {
      throw new Error("Check-out must be for today.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing, error: findError } = await supabaseAdmin
      .from("attendance_records")
      .select("id, check_in")
      .eq("employee_id", employeeId)
      .eq("work_date", data.workDate)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing?.check_in) throw new Error("Check in first before checking out.");

    const shift = await loadShift(supabaseAdmin, employeeId, data.workDate);
    const { data: employeeOrg } = await supabaseAdmin
      .from("employees")
      .select("organization_id")
      .eq("id", employeeId)
      .maybeSingle();
    const { data: holidayRows } = await supabaseAdmin
      .from("company_holidays")
      .select("date, organization_id, optional");
    const orgId = (employeeOrg as { organization_id?: string | null } | null)?.organization_id;
    const holidayDates = new Set(
      (holidayRows ?? [])
        .filter(
          (h: { optional: boolean; organization_id: string | null }) =>
            h.optional !== true &&
            (h.organization_id == null || h.organization_id === "" || h.organization_id === orgId),
        )
        .map((h: { date: string }) => h.date),
    );
    const checkInLocalMin = localMinutesAt(existing.check_in, data.localTime, data.checkOutIso);
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const metrics = computeMetrics({
      shift,
      localDate: data.workDate,
      localCheckIn: `${pad2(Math.floor(checkInLocalMin / 60))}:${pad2(checkInLocalMin % 60)}`,
      localCheckOut: localDateTimeAt(data.checkOutIso, data.localTime, data.checkOutIso),
      checkInIso: existing.check_in,
      checkOutIso: data.checkOutIso,
      holidays: holidayDates,
    });

    const { data: row, error } = await supabaseAdmin
      .from("attendance_records")
      .update({
        check_out: data.checkOutIso,
        ...metrics,
        source: "self_check_out",
        updated_by: context.userId,
      } as never)
      .eq("id", existing.id)
      .select(
        "id, check_in, check_out, status, late_minutes, early_login_minutes, work_hours, overtime_minutes, late_logout_minutes, early_departure_minutes, is_half_day",
      )
      .single();
    if (error) throw error;

    return { attendance: row as unknown as AttendanceRow };
  });

const monthlySummarySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  departmentId: z.string().uuid().nullable().optional(),
  employeeId: z.string().uuid().nullable().optional(),
});

/**
 * Months that actually contain attendance rows in PostgreSQL, newest first.
 *
 * Derived from the database rather than the page's loaded date range, so a
 * month whose rows sit outside the current range still appears in the selector
 * and can be selected. Respects the same employee/department scope as the
 * monthly summary.
 */
export const fetchAvailableMonths = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => monthlySummarySchema.parse(data))
  .handler(async ({ data, context }) => {
    let employeeIds: string[] | null = null;
    if (data.employeeId) {
      const { data: allowed } = await context.supabase.rpc("can_view_employee", {
        _user_id: context.userId,
        _employee_id: data.employeeId,
      });
      if (!allowed) throw new Error("You cannot view attendance for this employee.");
      employeeIds = [data.employeeId];
    } else if (data.departmentId) {
      const { data: members, error: memberError } = await context.supabase
        .from("employees")
        .select("id")
        .eq("department_id", data.departmentId);
      if (memberError) throw memberError;
      employeeIds = (members ?? []).map((e: { id: string }) => e.id);
    }

    let query = context.supabase.from("attendance_records").select("work_date");
    if (employeeIds) {
      if (!employeeIds.length) return { months: [] as string[] };
      query = query.in("employee_id", employeeIds);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    // Reduce to a distinct, sorted `YYYY-MM` list. Pulling every work_date keeps
    // this a plain PostgREST read rather than a new RPC/aggregation endpoint.
    const months = [
      ...new Set((rows ?? []).map((r: { work_date: string }) => r.work_date.slice(0, 7))),
    ];
    return { months: months.sort().reverse() };
  });

/**
 * Monthly attendance summary computed from the complete month of rows in
 * PostgreSQL, so the figures never depend on the date range the page loaded.
 */
export const fetchMonthlySummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => monthlySummarySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { start, end } = monthBounds(data.month);

    // Resolve the requested scope and confirm the caller may see it.
    let employeeIds: string[] | null = null;
    if (data.employeeId) {
      const { data: allowed } = await context.supabase.rpc("can_view_employee", {
        _user_id: context.userId,
        _employee_id: data.employeeId,
      });
      if (!allowed) throw new Error("You cannot view attendance for this employee.");
      employeeIds = [data.employeeId];
    } else if (data.departmentId) {
      const { data: members, error: memberError } = await context.supabase
        .from("employees")
        .select("id")
        .eq("department_id", data.departmentId);
      if (memberError) throw memberError;
      employeeIds = (members ?? []).map((e: { id: string }) => e.id);
    }

    let query = context.supabase
      .from("attendance_records")
      .select(
        "work_date, check_in, check_out, status, late_minutes, early_login_minutes, overtime_minutes, late_logout_minutes, early_departure_minutes, work_minutes, work_hours",
      )
      .gte("work_date", start)
      .lte("work_date", end);

    if (employeeIds) {
      if (!employeeIds.length) return aggregateMonthly(data.month, []);
      query = query.in("employee_id", employeeIds);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    return aggregateMonthly(data.month, (rows ?? []) as MonthlyRecord[]);
  });

const correctionSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requestedCheckIn: z.string().nullable(),
  requestedCheckOut: z.string().nullable(),
  requestedStatus: z.string().nullable(),
  reason: z.string().min(1, "A reason is required.").max(500),
});

/** Employees (or HR on their behalf) request a correction to a recorded day. */
export const requestAttendanceCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => correctionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const employeeId = await callerEmployee(context);
    if (!employeeId) throw new Error("No employee profile is linked to this account.");

    const { data: existing, error: findError } = await context.supabase
      .from("attendance_records")
      .select("id")
      .eq("employee_id", employeeId)
      .eq("work_date", data.workDate)
      .maybeSingle();
    if (findError) throw findError;

    const { data: inserted, error } = await context.supabase
      .from("attendance_corrections")
      .insert({
        employee_id: employeeId,
        work_date: data.workDate,
        attendance_id: existing?.id ?? null,
        requested_check_in: data.requestedCheckIn,
        requested_check_out: data.requestedCheckOut,
        requested_status: data.requestedStatus,
        reason: data.reason,
      })
      .select("id, status")
      .single();
    if (error) throw error;
    return { correction: inserted };
  });

const decideSchema = z.object({
  correctionId: z.string().uuid(),
  approve: z.boolean(),
  decisionNote: z.string().max(500).optional(),
});

/** Managers/HR decide a correction; approval also updates the underlying attendance record. */
export const decideAttendanceCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => decideSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: correction, error: getError } = await context.supabase
      .from("attendance_corrections")
      .select("*")
      .eq("id", data.correctionId)
      .single();
    if (getError) throw getError;
    if (correction.status !== "pending")
      throw new Error("This correction has already been decided.");

    const { data: isManager } = await context.supabase.rpc("is_manager", {
      _user_id: context.userId,
    });
    if (!isManager) throw new Error("Forbidden: Manager or HR access is required.");
    const { data: scoped } = await context.supabase.rpc("can_view_employee", {
      _user_id: context.userId,
      _employee_id: correction.employee_id,
    });
    if (!scoped) throw new Error("You cannot approve corrections for this employee.");
    const approverEmployeeId = await callerEmployee(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const decision = {
      status: data.approve ? "approved" : "rejected",
      approver_id: approverEmployeeId,
      decided_at: new Date().toISOString(),
      decision_note: data.decisionNote ?? null,
    } as never;
    if (data.approve) {
      const { data: record, error: upsertError } = await supabaseAdmin
        .from("attendance_records")
        .upsert(
          {
            employee_id: correction.employee_id,
            work_date: correction.work_date,
            check_in: correction.requested_check_in,
            check_out: correction.requested_check_out,
            status: correction.requested_status ?? "present",
            updated_by: context.userId,
            source: "correction",
          },
          { onConflict: "employee_id,work_date" },
        )
        .select("id")
        .single();
      if (upsertError) throw upsertError;
      await supabaseAdmin
        .from("attendance_corrections")
        .update(decision)
        .eq("id", data.correctionId);
      await supabaseAdmin
        .from("attendance_records")
        .update({ updated_by: context.userId })
        .eq("id", record.id);
    } else {
      await supabaseAdmin
        .from("attendance_corrections")
        .update(decision)
        .eq("id", data.correctionId);
    }

    return { ok: true };
  });
