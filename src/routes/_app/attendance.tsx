import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Clock, LogIn, LogOut, Pencil } from "lucide-react";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/hr/primitives";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import {
  checkIn,
  checkOut,
  decideAttendanceCorrection,
  fetchAvailableMonths,
  fetchMonthlySummary,
  requestAttendanceCorrection,
} from "@/lib/attendance.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchDepartments, fetchEmployees, labelMap, nameMap } from "@/lib/hr-queries";
import { aggregateOvertime, weekStartDate, type OvertimeContext } from "@/lib/overtime";
import { canAccess, isManager } from "@/lib/rbac";

export const Route = createFileRoute("/_app/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — Spine AI" },
      {
        name: "description",
        content:
          "Daily, weekly and monthly attendance with corrections, check-in and anomaly detection.",
      },
      { property: "og:title", content: "Attendance — Spine AI" },
      { property: "og:description", content: "Attendance metrics and anomaly insights." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AttendancePage,
});

const RANGES = { "7": "Last 7 days", "30": "Last 30 days", "45": "Last 45 days" } as const;

type RecordRow = {
  id: string;
  employee_id: string;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  late_minutes: number;
  early_login_minutes: number;
  overtime_minutes: number;
  late_logout_minutes: number;
  early_departure_minutes: number;
  work_minutes: number | null;
  work_hours: number | null;
  is_half_day: boolean;
};

/** Minutes -> compact "1h 05m" / "45m" text. */
function fmtMinutes(min: number) {
  const m = Math.max(0, Math.round(min || 0));
  if (!m) return "0m";
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${String(rest).padStart(2, "0")}m` : `${h}h`;
}

/** Legacy decimal hours -> whole minutes, for rows predating `work_minutes`. */
function minutesFromHours(hours: number | null | undefined) {
  return hours == null ? 0 : Math.round(hours * 60);
}

/** Minutes -> "Xh YYm" with a zeroed minute field, for overtime breakdown cells. */
function fmtHm(min: number) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

function fmtClock(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "2026-09-25" -> "25 Sep" */
function fmtDay(date: string) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  const d = new Date(`${key}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Compact stat block: same surface-card border/radius as StatCard, sized down. */
function MetricBlock({
  label,
  value,
  hint,
  hero = false,
  muted = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  hero?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={cn("surface-card px-3 py-2.5", hero && "px-4 py-4")}>
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-semibold tabular-nums",
          hero ? "text-3xl" : "text-base",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </p>
      {hint ? <p className="truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function AttendancePage() {
  const { roles, permissions, employee, user } = useAuth();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<keyof typeof RANGES>("30");
  const [month, setMonth] = useState(() => monthKey(new Date().toISOString()));
  const [dept, setDept] = useState("all");
  const [employeeId, setEmployeeId] = useState("all");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [decideNote, setDecideNote] = useState("");
  const [deciding, setDeciding] = useState<{ id: string; action: "approved" | "rejected" } | null>(
    null,
  );

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const departmentsQuery = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });

  const shiftsQuery = useQuery({
    queryKey: ["shifts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shifts").select("*").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const assignmentsQuery = useQuery({
    queryKey: ["shift-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_shift_assignments")
        .select("employee_id, shift_id, effective_from, effective_to, is_active");
      if (error) throw error;
      return data ?? [];
    },
  });

  const holidaysQuery = useQuery({
    queryKey: ["company-holidays"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_holidays")
        .select("date, organization_id, optional");
      if (error) throw error;
      return data ?? [];
    },
  });

  const attendanceQuery = useQuery({
    queryKey: ["attendance", range, dept, employeeId],
    queryFn: async () => {
      const since = new Date(Date.now() - Number(range) * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("attendance_records")
        .select(
          "id, employee_id, work_date, check_in, check_out, status, late_minutes, early_login_minutes, overtime_minutes, late_logout_minutes, early_departure_minutes, work_minutes, work_hours, is_half_day, source, note",
        )
        .gte("work_date", since)
        .order("work_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RecordRow[];
    },
  });

  const correctionsQuery = useQuery({
    queryKey: ["attendance-corrections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_corrections")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // The monthly summary is aggregated server-side from every record stored for
  // the selected month, independent of the `range` filter used for the table.
  const monthlySummaryQuery = useQuery({
    queryKey: ["attendance-monthly-summary", month, dept, employeeId],
    queryFn: () =>
      fetchMonthlySummary({
        data: {
          month,
          departmentId: dept === "all" ? null : dept,
          employeeId: employeeId === "all" ? null : employeeId,
        },
      }),
  });
  const monthSummary = monthlySummaryQuery.data;

  // Months come from PostgreSQL, not from the rows the page happens to have
  // loaded, so a month outside the current range stays selectable.
  const availableMonthsQuery = useQuery({
    queryKey: ["attendance-available-months", dept, employeeId],
    queryFn: () =>
      fetchAvailableMonths({
        data: {
          departmentId: dept === "all" ? null : dept,
          employeeId: employeeId === "all" ? null : employeeId,
        },
      }),
  });

  const today = new Date().toISOString().slice(0, 10);
  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);
  const names = nameMap(employees);
  const deptNames = labelMap(departmentsQuery.data ?? []);
  const deptById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.department_id])),
    [employees],
  );

  const records = useMemo(
    () =>
      (attendanceQuery.data ?? []).filter(
        (r) =>
          (dept === "all" || deptById.get(r.employee_id) === dept) &&
          (employeeId === "all" || r.employee_id === employeeId),
      ),
    [attendanceQuery.data, dept, employeeId, deptById],
  );

  const myToday = (attendanceQuery.data ?? []).find(
    (r) => employee && r.employee_id === employee.id && r.work_date === today,
  );

  // Context used to classify stored overtime: the employee's currently assigned
  // shift and the company holidays applicable to their organization. Mirrors
  // the rules the daily calculator used at check-out (`attendance.functions`).
  const shifts = useMemo(() => shiftsQuery.data ?? [], [shiftsQuery.data]);
  const shiftById = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts]);
  const assignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data]);
  const holidayRows = useMemo(() => holidaysQuery.data ?? [], [holidaysQuery.data]);
  const overtimeContext = useMemo<OvertimeContext>(() => {
    const empById = new Map(employees.map((e) => [e.id, e]));
    return (employeeId) => {
      const orgId = empById.get(employeeId ?? "")?.organization_id ?? "";
      const holidays = new Set(
        holidayRows
          .filter(
            (h) =>
              h.optional !== true &&
              (h.organization_id == null ||
                h.organization_id === "" ||
                h.organization_id === orgId),
          )
          .map((h) => h.date),
      );
      const active = (
        assignments as {
          employee_id: string;
          shift_id: string;
          effective_from: string;
          effective_to: string | null;
          is_active: boolean;
        }[]
      )
        .filter((a) => a.employee_id === employeeId && a.is_active && a.effective_from <= today)
        .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))
        .find((a) => a.effective_to == null || a.effective_to >= today);
      return {
        shift: active ? (shiftById.get(active.shift_id) ?? null) : null,
        holidays,
      };
    };
  }, [employees, assignments, holidayRows, shiftById, today]);

  // The payable overtime total for the filtered range and the week-to-date view
  // for the signed-in employee, both computed with the double-count protection.
  const breakdown = useMemo(
    () => aggregateOvertime(records, overtimeContext),
    [records, overtimeContext],
  );

  const myWeek = useMemo(
    () =>
      (attendanceQuery.data ?? []).filter(
        (r) =>
          employee &&
          r.employee_id === employee.id &&
          r.work_date >= weekStartDate(today) &&
          r.work_date <= today,
      ),
    [attendanceQuery.data, employee, today],
  );
  const myWeekBreakdown = useMemo(
    () => aggregateOvertime(myWeek, overtimeContext),
    [myWeek, overtimeContext],
  );
  const myDayOvertime = myWeekBreakdown.days.find((d) => d.workDate === today);

  const checkInMutation = useMutation({
    mutationFn: async () => {
      const now = new Date();
      return checkIn({
        data: {
          workDate: today,
          checkInIso: now.toISOString(),
          localTime: now.toTimeString().slice(0, 8),
        },
      });
    },
    onSuccess: () => {
      toast.success("Checked in");
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Check-in failed"),
  });

  const checkOutMutation = useMutation({
    mutationFn: async () => {
      const now = new Date();
      return checkOut({
        data: {
          workDate: today,
          checkInIso: myToday?.check_in ?? now.toISOString(),
          checkOutIso: now.toISOString(),
          localTime: now.toTimeString().slice(0, 8),
        },
      });
    },
    onSuccess: () => {
      toast.success("Checked out");
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Check-out failed"),
  });

  const requestCorr = useMutation({
    mutationFn: async (form: {
      workDate: string;
      checkIn: string;
      checkOut: string;
      reason: string;
    }) => {
      if (!employee) throw new Error("No employee profile linked.");
      return requestAttendanceCorrection({
        data: {
          workDate: form.workDate,
          requestedCheckIn: form.checkIn
            ? new Date(`${form.workDate}T${form.checkIn}`).toISOString()
            : null,
          requestedCheckOut: form.checkOut
            ? new Date(`${form.workDate}T${form.checkOut}`).toISOString()
            : null,
          requestedStatus: null,
          reason: form.reason,
        },
      });
    },
    onSuccess: () => {
      toast.success("Correction requested");
      setCorrectionOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["attendance-corrections"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Request failed"),
  });

  const decide = useMutation({
    mutationFn: async () => {
      if (!deciding) return;
      return decideAttendanceCorrection({
        data: {
          correctionId: deciding.id,
          approve: deciding.action === "approved",
          decisionNote: decideNote,
        },
      });
    },
    onSuccess: () => {
      toast.success(
        deciding?.action === "approved" ? "Correction approved" : "Correction rejected",
      );
      setDeciding(null);
      setDecideNote("");
      void queryClient.invalidateQueries({ queryKey: ["attendance-corrections"] });
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Decision failed"),
  });

  if (!canAccess("attendance", roles, permissions))
    return <NoPermissionState what="attendance data" />;
  if (
    attendanceQuery.isLoading ||
    employeesQuery.isLoading ||
    shiftsQuery.isLoading ||
    assignmentsQuery.isLoading ||
    holidaysQuery.isLoading
  )
    return <LoadingState rows={6} />;
  if (attendanceQuery.isError) return <ErrorState message="Unable to load attendance data." />;

  const present = records.filter((r) => r.status === "present").length;
  const late = records.filter((r) => r.status === "late").length;
  const halfDays = records.filter((r) => r.status === "half_day").length;
  const absent = records.filter((r) => r.status === "absent").length;
  // Overtime shown in the table header is the payable total from the breakdown,
  // where each minute is counted once even when weekly OT overlaps day-level OT.
  const overtimeHours = Math.round(breakdown.totalOvertimeMinutes / 60);
  const pct = records.length ? Math.round(((present + late) / records.length) * 100) : 0;

  // Second compact metrics row: real working-hour aggregates over the range.
  // Sourced from `work_minutes` (authoritative) with a fallback to legacy
  // `work_hours`, summed in whole minutes so figures stay exact.
  const rowMinutes = (r: (typeof records)[number]) =>
    r.work_minutes ?? (r.work_hours != null ? Math.round(r.work_hours * 60) : null);
  const worked = records.filter((r) => rowMinutes(r) != null);
  const totalWorkMinutes = worked.reduce((s, r) => s + (rowMinutes(r) ?? 0), 0);
  const avgWorkMinutes = worked.length ? Math.round(totalWorkMinutes / worked.length) : 0;
  const totalEarlyLogin = records.reduce((s, r) => s + (r.early_login_minutes ?? 0), 0);
  const totalLateLogin = records.reduce((s, r) => s + (r.late_minutes ?? 0), 0);
  const totalEarlyLogout = records.reduce((s, r) => s + (r.early_departure_minutes ?? 0), 0);
  const totalLateLogout = records.reduce((s, r) => s + (r.late_logout_minutes ?? 0), 0);

  // Monthly figures come from `monthSummary` (server-side, whole month).

  const lateCount = new Map<string, number>();
  records
    .filter((r) => r.status === "late")
    .forEach((r) => {
      lateCount.set(r.employee_id, (lateCount.get(r.employee_id) ?? 0) + 1);
    });
  const absentCount = new Map<string, number>();
  records
    .filter((r) => r.status === "absent")
    .forEach((r) => {
      absentCount.set(r.employee_id, (absentCount.get(r.employee_id) ?? 0) + 1);
    });
  const anomalies = [...lateCount.entries()]
    .filter(([, v]) => v >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([id, lateDays]) => ({
      id,
      name: names.get(id) ?? "—",
      department: deptNames.get(deptById.get(id) ?? "") ?? "—",
      lateDays,
      absences: absentCount.get(id) ?? 0,
      risk: lateDays >= 6 ? "critical" : "warning",
    }));

  const byDepartment = (departmentsQuery.data ?? []).map((d) => {
    const rows = records.filter((r) => deptById.get(r.employee_id) === d.id);
    const ok = rows.filter((r) => r.status !== "absent").length;
    return { name: d.code, attendance: rows.length ? Math.round((ok / rows.length) * 100) : 0 };
  });

  const corrections = correctionsQuery.data ?? [];
  const pendingCorrections = corrections.filter((c) => c.status === "pending");
  const approver = isManager(roles);

  // Newest first, always including the current month so a fresh install is
  // usable before any rows exist. Months come from the server.
  const availableMonths = [
    ...new Set<string>([
      monthKey(new Date().toISOString()),
      ...(availableMonthsQuery.data?.months ?? []),
    ]),
  ]
    .sort()
    .reverse();

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Presence, punctuality, self check-in and correction requests for the employees you are authorized to see."
        actions={
          <div className="flex gap-2">
            {employee ? (
              <Dialog open={correctionOpen} onOpenChange={setCorrectionOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Pencil className="mr-2 h-4 w-4" /> Request correction
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Request attendance correction</DialogTitle>
                  </DialogHeader>
                  <form
                    id="correction-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      requestCorr.mutate({
                        workDate: String(fd.get("work_date")),
                        checkIn: String(fd.get("check_in") ?? ""),
                        checkOut: String(fd.get("check_out") ?? ""),
                        reason: String(fd.get("reason") ?? ""),
                      });
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="work_date">Work date</Label>
                      <Input id="work_date" name="work_date" type="date" max={today} required />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="check_in">Corrected check-in</Label>
                        <Input id="check_in" name="check_in" type="time" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="check_out">Corrected check-out</Label>
                        <Input id="check_out" name="check_out" type="time" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reason">Reason</Label>
                      <Textarea
                        id="reason"
                        name="reason"
                        rows={3}
                        required
                        placeholder="Explain what went wrong"
                      />
                    </div>
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="correction-form" disabled={requestCorr.isPending}>
                      {requestCorr.isPending ? "Submitting..." : "Submit correction"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null}
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {(departmentsQuery.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {names.get(e.id) ?? "—"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={range} onValueChange={(v) => setRange(v as keyof typeof RANGES)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(RANGES).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      {employee ? (
        <SectionCard
          title={`My day — ${today}`}
          description={
            myToday?.check_in ? "You already checked in today." : "Check in when your shift starts."
          }
          actions={
            <div className="flex items-center gap-2">
              {myToday?.check_in ? (
                <Button size="sm" variant="outline" disabled className="tabular-nums">
                  <Clock className="mr-2 h-4 w-4" />{" "}
                  {new Date(myToday.check_in).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Button>
              ) : null}
              {!myToday?.check_in ? (
                <Button
                  size="sm"
                  onClick={() => checkInMutation.mutate()}
                  disabled={checkInMutation.isPending}
                >
                  <LogIn className="mr-2 h-4 w-4" /> Check in
                </Button>
              ) : null}
              {myToday?.check_in && !myToday.check_out ? (
                <Button
                  size="sm"
                  onClick={() => checkOutMutation.mutate()}
                  disabled={checkOutMutation.isPending}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Check out
                </Button>
              ) : null}
              {myToday ? (
                <StatusBadge status={myToday.status} />
              ) : (
                <StatusBadge status="not_clocked" />
              )}
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Login time</p>
              <p className="font-medium tabular-nums">{fmtClock(myToday?.check_in)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Logout time</p>
              <p className="font-medium tabular-nums">{fmtClock(myToday?.check_out)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Worked hours</p>
              <p className="font-medium tabular-nums">
                {fmtMinutes(myToday?.work_minutes ?? minutesFromHours(myToday?.work_hours))}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Late / early login
              </p>
              <p className="font-medium tabular-nums">
                {fmtMinutes(myToday?.late_minutes ?? 0)} /{" "}
                {fmtMinutes(myToday?.early_login_minutes ?? 0)}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 xl:grid-cols-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Regular</p>
              <p className="font-medium tabular-nums text-muted-foreground">
                {fmtHm(myDayOvertime?.regularMinutes ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Daily OT</p>
              <p className="font-medium tabular-nums">
                {fmtHm(myDayOvertime?.dailyOvertimeMinutes ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Weekly OT</p>
              <p className="font-medium tabular-nums">
                {fmtHm(myDayOvertime?.weeklyOvertimeMinutes ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Weekend OT</p>
              <p className="font-medium tabular-nums">
                {fmtHm(myDayOvertime?.weekendOvertimeMinutes ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Holiday OT</p>
              <p className="font-medium tabular-nums">
                {fmtHm(myDayOvertime?.holidayOvertimeMinutes ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-primary">Total OT</p>
              <p className="text-lg font-semibold tabular-nums text-primary">
                {fmtHm(myDayOvertime?.totalOvertimeMinutes ?? 0)}
              </p>
            </div>
          </div>
        </SectionCard>
      ) : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Attendance rate" value={`${pct}%`} />
        <StatCard label="Present" value={present} tone="success" />
        <StatCard label="Late" value={late} tone="warning" />
        <StatCard label="Half day" value={halfDays} tone="warning" />
        <StatCard label="Absent" value={absent} tone="destructive" />
      </div>

      {/* Compact working-hour metrics, sized to match the row above without crowding it. */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <MetricBlock
          label="Avg hours"
          value={fmtMinutes(avgWorkMinutes)}
          hint={`${worked.length} logged days`}
        />
        <MetricBlock label="Total hours" value={fmtMinutes(totalWorkMinutes)} />
        <MetricBlock
          label="Overtime"
          value={fmtMinutes(breakdown.totalOvertimeMinutes)}
          hint={`${breakdown.completedDays} completed days`}
        />
        <MetricBlock label="Early login" value={fmtMinutes(totalEarlyLogin)} />
        <MetricBlock label="Late login" value={fmtMinutes(totalLateLogin)} />
        <MetricBlock label="Early logout" value={fmtMinutes(totalEarlyLogout)} />
        <MetricBlock label="Late logout" value={fmtMinutes(totalLateLogout)} />
      </div>

      <SectionCard
        title="Overtime breakdown"
        description="Overtime classified by cause for this range"
        className="mt-6"
      >
        {breakdown.completedDays === 0 ? (
          <EmptyState title="No attendance records in this scope." />
        ) : (
          <>
            <MetricBlock
              hero
              label="Total OT"
              value={fmtHm(breakdown.totalOvertimeMinutes)}
              hint="Counted once, even across categories"
            />
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              <MetricBlock
                label="Daily OT"
                value={fmtHm(breakdown.dailyOvertimeMinutes)}
                hint="beyond shift hours"
              />
              <MetricBlock
                label="Weekly OT"
                value={fmtHm(breakdown.weeklyOvertimeMinutes)}
                hint="beyond weekly hours"
              />
              <MetricBlock
                label="Weekend OT"
                value={fmtHm(breakdown.weekendOvertimeMinutes)}
                hint="rest-day work"
              />
              <MetricBlock
                label="Holiday OT"
                value={fmtHm(breakdown.holidayOvertimeMinutes)}
                hint="company holidays"
              />
              <MetricBlock
                muted
                label="Regular"
                value={fmtHm(breakdown.regularMinutes)}
                hint="paid base time"
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Daily overtime counts only after worked time exceeds the shift&apos;s threshold.
            </p>
          </>
        )}
      </SectionCard>

      <SectionCard
        title={`Monthly summary — ${monthLabel(month)}`}
        description="Calculated from the complete month of attendance records"
        className="mt-6"
        actions={
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableMonths.map((m) => (
                <SelectItem key={m} value={m}>
                  {monthLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {monthlySummaryQuery.isPending ? (
          <LoadingState rows={3} />
        ) : monthlySummaryQuery.isError ? (
          <ErrorState
            message={
              (monthlySummaryQuery.error as Error)?.message ??
              "Could not calculate the monthly summary."
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <MetricBlock
                label="Avg hours"
                value={fmtMinutes(monthSummary?.averageWorkMinutes ?? 0)}
                hint={`${monthSummary?.completedDaysWithHours ?? 0} completed days`}
              />
              <MetricBlock
                label="Total hours"
                value={fmtMinutes(monthSummary?.totalWorkMinutes ?? 0)}
              />
              <MetricBlock label="Present days" value={monthSummary?.presentDays ?? 0} />
              <MetricBlock label="Absent days" value={monthSummary?.absentDays ?? 0} />
              <MetricBlock
                label="Incomplete"
                value={monthSummary?.incompleteDays ?? 0}
                hint="no check-out"
              />
              <MetricBlock
                label="Overtime"
                value={fmtMinutes(monthSummary?.totalOvertimeMinutes ?? 0)}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricBlock label="Early logins" value={monthSummary?.earlyLoginCount ?? 0} />
              <MetricBlock label="Late logins" value={monthSummary?.lateLoginCount ?? 0} />
              <MetricBlock label="Early logouts" value={monthSummary?.earlyLogoutCount ?? 0} />
              <MetricBlock label="Late logouts" value={monthSummary?.lateLogoutCount ?? 0} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {monthSummary?.start} to {monthSummary?.end} · {monthSummary?.lateDays ?? 0} late ·{" "}
              {monthSummary?.halfDays ?? 0} half day · {monthSummary?.totalRecords ?? 0} record
              {(monthSummary?.totalRecords ?? 0) === 1 ? "" : "s"} in month
            </p>
          </>
        )}
      </SectionCard>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Attendance by department">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byDepartment}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={12} />
              <YAxis domain={[0, 100]} stroke="var(--color-muted-foreground)" fontSize={12} />
              <Tooltip />
              <Bar dataKey="attendance" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard
          title="AI attendance insights"
          description="Employees with repeated lateness in the selected period"
          className="ai-surface"
        >
          {anomalies.length === 0 ? (
            <EmptyState title="No attendance anomalies detected." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Late days</TableHead>
                  <TableHead>Risk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {anomalies.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell>{a.department}</TableCell>
                    <TableCell>{a.lateDays}</TableCell>
                    <TableCell>
                      <StatusBadge status={a.risk} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>

      {approver ? (
        <SectionCard title="Pending corrections" className="mt-6">
          {pendingCorrections.length === 0 ? (
            <EmptyState title="No pending corrections." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Work date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingCorrections.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{names.get(c.employee_id) ?? "—"}</TableCell>
                    <TableCell>{c.work_date}</TableCell>
                    <TableCell className="max-w-xs truncate">{c.reason}</TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        size="sm"
                        onClick={() => setDeciding({ id: c.id, action: "approved" })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeciding({ id: c.id, action: "rejected" })}
                      >
                        Reject
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      ) : null}

      <SectionCard
        title="Attendance records"
        className="mt-6"
        actions={<span className="text-xs text-muted-foreground">Overtime: {overtimeHours}h</span>}
      >
        {records.length === 0 ? (
          <EmptyState title="No attendance records in this range." />
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead className="hidden sm:table-cell">Department</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead>Logout</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Late</TableHead>
                  <TableHead className="hidden md:table-cell">Early</TableHead>
                  <TableHead className="hidden lg:table-cell">Overtime</TableHead>
                  <TableHead className="hidden lg:table-cell">Work hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.slice(0, 200).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{fmtDay(r.work_date)}</TableCell>
                    <TableCell className="font-medium whitespace-nowrap">
                      {names.get(r.employee_id) ?? "—"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap">
                      {deptNames.get(deptById.get(r.employee_id) ?? "") ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      {fmtClock(r.check_in)}
                    </TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      {fmtClock(r.check_out)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell tabular-nums">
                      {fmtMinutes(r.late_minutes)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell tabular-nums">
                      {fmtMinutes(r.early_login_minutes)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell tabular-nums">
                      {fmtMinutes(r.overtime_minutes)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell tabular-nums whitespace-nowrap">
                      {fmtMinutes(r.work_minutes ?? minutesFromHours(r.work_hours))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Correction history" className="mt-6">
        {corrections.length === 0 ? (
          <EmptyState title="No correction requests yet." />
        ) : (
          <div className="max-h-[320px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Work date</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Decision note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corrections.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{names.get(c.employee_id) ?? "—"}</TableCell>
                    <TableCell>{c.work_date}</TableCell>
                    <TableCell className="max-w-xs truncate">{c.reason}</TableCell>
                    <TableCell>
                      <StatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{c.decision_note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <Dialog open={Boolean(deciding)} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {deciding?.action === "approved" ? "Approve correction" : "Reject correction"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decide_note">Decision note (optional)</Label>
            <Textarea
              id="decide_note"
              rows={3}
              value={decideNote}
              onChange={(e) => setDecideNote(e.target.value)}
              placeholder="Public note shown to the employee"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button onClick={() => decide.mutate()} disabled={decide.isPending}>
              {decide.isPending ? "Deciding..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
