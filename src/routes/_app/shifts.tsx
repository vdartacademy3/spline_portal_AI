import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Plus, UserPlus } from "lucide-react";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/hr/primitives";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/shifts")({
  head: () => ({
    meta: [
      { title: "Shifts — Spine AI" },
      { name: "description", content: "Shift definitions, assignments and overnight schedules." },
      { property: "og:title", content: "Shifts — Spine AI" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ShiftsPage,
});

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Renders canonical 1-based weekday values (1=Mon .. 7=Sun) in Monday-first order. */
function workingDaysLabel(days: number[] | null | undefined): string {
  return [...(days ?? [])]
    .filter((d) => d >= 1 && d <= 7)
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d - 1])
    .join(", ");
}

const SHIFT_TYPES = [
  { label: "Day", code: "MOR" },
  { label: "Evening", code: "EVE" },
  { label: "Night", code: "NIGHT" },
  { label: "General", code: "GEN" },
] as const;

function parseTimeToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

function fmtHM(mins: number): string {
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function scheduledSpanMinutes(startM: number, endM: number, overnight: boolean): number {
  return (overnight || endM < startM ? 1440 : 0) + endM - startM;
}

function numOr(v: FormDataEntryValue | string | null | undefined, fallback: number): number {
  const s = v == null ? "" : String(v).trim();
  if (s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

function ShiftDefSelect({
  options,
  name,
  placeholder = "Select shift",
}: {
  options: { id: string; name: string; start_time: string; end_time: string; overnight: boolean }[];
  name: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <>
      <input type="hidden" name={name} value={value} required />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name} ({o.start_time.slice(0, 5)}–{o.end_time.slice(0, 5)}
              {o.overnight ? " +1d" : ""})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function EmployeeSelect({ options, name }: { options: { id: string }[]; name: string }) {
  const [value, setValue] = useState("");
  const names = nameMap(options as never);
  return (
    <>
      <input type="hidden" name={name} value={value} required />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder="Select employee" />
        </SelectTrigger>
        <SelectContent>
          {(options as { id: string }[]).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {names.get(o.id) ?? "—"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function ShiftsPage() {
  const { roles, permissions, employee, user } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [overnight, setOvernight] = useState(false);
  const [breakMinutes, setBreakMinutes] = useState("");
  const [minimumHours, setMinimumHours] = useState("");

  const onTypeChange = (codeValue: string) => {
    setCode(codeValue);
    const t = SHIFT_TYPES.find((x) => x.code === codeValue);
    if (t) setName(t.label);
  };

  const canManage = canAccess("shifts", roles, permissions) && isHr(roles);
  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });

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
        .select("*")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const createShift = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { data, error } = await supabase
        .from("shifts")
        .insert({
          name: String(form["name"]),
          code: String(form["code"]).toUpperCase(),
          start_time: String(form["start_time"]),
          end_time: String(form["end_time"]),
          break_minutes: numOr(form["break_minutes"], 60),
          grace_minutes: numOr(form["grace_minutes"], 30),
          overtime_after_minutes: numOr(form["overtime_after_minutes"], 0),
          weekly_overtime_after_minutes: numOr(form["weekly_overtime_after_minutes"], 0),
          minimum_hours: numOr(form["minimum_hours"], 8),
          half_day_hours: numOr(form["half_day_hours"], 4),
          overnight: Boolean(form["overnight"]),
          days_of_week: days,
          status: "active",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "shift.created",
        entity: "shifts",
        entityId: data.id as string,
      });
    },
    onSuccess: () => {
      toast.success("Shift created");
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["shifts"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create shift"),
  });

  const deactivateShift = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("shifts")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => toast.success("Shift updated"),
    onError: () => toast.error("Could not update shift"),
  });

  const assign = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { error } = await supabase.from("employee_shift_assignments").insert({
        employee_id: String(form["employee_id"]),
        shift_id: String(form["shift_id"]),
        effective_from: String(form["effective_from"]),
        assigned_by: employee?.id ?? null,
      });
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "shift.assigned",
        entity: "employee_shift_assignments",
        next: { employee_id: form["employee_id"], shift_id: form["shift_id"] },
      });
    },
    onSuccess: () => {
      toast.success("Shift assigned");
      setAssignOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["shift-assignments"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not assign shift"),
  });

  const endAssignment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("employee_shift_assignments")
        .update({ is_active: false, effective_to: new Date().toISOString().slice(0, 10) })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Assignment ended");
      void queryClient.invalidateQueries({ queryKey: ["shift-assignments"] });
    },
    onError: () => toast.error("Could not end assignment"),
  });

  if (!canAccess("shifts", roles, permissions)) return <NoPermissionState what="shift schedule" />;
  if (shiftsQuery.isLoading) return <LoadingState rows={6} />;
  if (shiftsQuery.isError) return <ErrorState message="Unable to load shift data." />;

  const shifts = shiftsQuery.data ?? [];
  const assignments = assignmentsQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const names = nameMap(employees);
  const shiftNames = new Map(shifts.map((s) => [s.id, s.name]));
  const activeAssignments = assignments.filter((a) => a.is_active);
  const myAssignment = activeAssignments.find((a) => employee && a.employee_id === employee.id);
  const myShift = shifts.find((s) => myAssignment?.shift_id === s.id);
  const employeesWithShifts = new Set(activeAssignments.map((a) => a.employee_id));

  const startM = parseTimeToMinutes(startTime);
  const endM = parseTimeToMinutes(endTime);
  const span =
    startM !== null && endM !== null ? scheduledSpanMinutes(startM, endM, overnight) : null;
  const breakEff = numOr(breakMinutes, 60);
  const net = span !== null ? span - breakEff : null;
  const minEff =
    minimumHours.trim() === ""
      ? net !== null && net > 0
        ? net / 60
        : null
      : numOr(minimumHours, 8);
  const breakTooLong = span !== null && breakEff >= span;
  const endBeforeStart = startM !== null && endM !== null && endM <= startM && !overnight;
  const minExceedsNet = net !== null && minEff !== null && minEff * 60 > net;

  return (
    <>
      <PageHeader
        title="Shifts"
        description="Shift templates, overtime rules and employee assignments, including overnight coverage."
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" /> New shift
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create shift</DialogTitle>
                  </DialogHeader>
                  <form
                    id="shift-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      const s = parseTimeToMinutes(String(fd.get("start_time") ?? ""));
                      const en = parseTimeToMinutes(String(fd.get("end_time") ?? ""));
                      if (s === null || en === null) {
                        toast.error("Start and end time are required.");
                        return;
                      }
                      if (en <= s && !overnight) {
                        toast.error("End time must be later than start time, or enable Overnight.");
                        return;
                      }
                      const span = scheduledSpanMinutes(s, en, overnight);
                      const breakEff = numOr(fd.get("break_minutes"), 60);
                      if (breakEff >= span) {
                        toast.error("Total break must be less than the shift duration.");
                        return;
                      }
                      const checks: [string, string][] = [
                        ["minimum_hours", "Minimum hours"],
                        ["half_day_hours", "Half day hours"],
                        ["break_minutes", "Break (min)"],
                        ["grace_minutes", "Grace (min)"],
                        ["overtime_after_minutes", "Overtime after (min)"],
                        ["weekly_overtime_after_minutes", "Weekly overtime after (min)"],
                      ];
                      for (const [key, label] of checks) {
                        const raw = String(fd.get(key) ?? "").trim();
                        if (raw !== "" && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) {
                          toast.error(`${label} must be 0 or more.`);
                          return;
                        }
                      }
                      if (String(fd.get("minimum_hours") ?? "").trim() === "") {
                        // Net hours, rounded down to the column's 2dp so the stored
                        // minimum can never exceed the achievable net minutes.
                        const netHours = Math.floor(((span - breakEff) / 60) * 100) / 100;
                        fd.set("minimum_hours", String(netHours));
                      }
                      if (overnight) fd.set("overnight", "true");
                      else fd.delete("overnight");
                      createShift.mutate(Object.fromEntries(fd.entries()));
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="shift_type">Shift Type</Label>
                      <Select
                        value={SHIFT_TYPES.some((t) => t.code === code) ? code : ""}
                        onValueChange={onTypeChange}
                      >
                        <SelectTrigger id="shift_type" className="w-full">
                          <SelectValue placeholder="Select shift type" />
                        </SelectTrigger>
                        <SelectContent>
                          {SHIFT_TYPES.map((t) => (
                            <SelectItem key={t.code} value={t.code}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="name">Shift name</Label>
                        <Input
                          id="name"
                          name="name"
                          required
                          placeholder="General / Morning"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="code">Code</Label>
                        <Input
                          id="code"
                          name="code"
                          required
                          placeholder="GEN"
                          maxLength={8}
                          value={code}
                          onChange={(e) => setCode(e.target.value.toUpperCase())}
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="start_time">Start time</Label>
                        <Input
                          id="start_time"
                          name="start_time"
                          type="time"
                          required
                          value={startTime}
                          onChange={(e) => setStartTime(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="end_time">End time</Label>
                        <Input
                          id="end_time"
                          name="end_time"
                          type="time"
                          required
                          value={endTime}
                          onChange={(e) => setEndTime(e.target.value)}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        name="overnight"
                        checked={overnight}
                        onCheckedChange={(v) => setOvernight(v === true)}
                      />
                      Overnight shift (ends next day)
                    </label>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="minimum_hours">Minimum hours</Label>
                        <Input
                          id="minimum_hours"
                          name="minimum_hours"
                          type="number"
                          min={0}
                          step={0.5}
                          value={minimumHours}
                          onChange={(e) => setMinimumHours(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="half_day_hours">Half day hours</Label>
                        <Input
                          id="half_day_hours"
                          name="half_day_hours"
                          type="number"
                          min={0}
                          step={0.5}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="break_minutes">Break (min)</Label>
                        <Input
                          id="break_minutes"
                          name="break_minutes"
                          type="number"
                          min={0}
                          value={breakMinutes}
                          onChange={(e) => setBreakMinutes(e.target.value)}
                        />
                      </div>
                    </div>
                    <div
                      id="shift_preview"
                      className="space-y-1 rounded-md border border-border bg-muted/40 p-3 text-sm"
                    >
                      {span === null ? (
                        <p className="text-muted-foreground">
                          Enter start and end time to preview duration.
                        </p>
                      ) : (
                        <>
                          <p id="preview_elapsed" className="tabular-nums">
                            Elapsed: {fmtHM(span)} · Break (total): {breakEff}m
                          </p>
                          <p id="preview_expected" className="tabular-nums">
                            Expected working time: {fmtHM(Math.max(span - breakEff, 0))}
                          </p>
                          <p id="preview_required" className="tabular-nums text-muted-foreground">
                            Required hours:{" "}
                            {minEff === null
                              ? "—"
                              : minimumHours.trim() === ""
                                ? `${fmtHM(net as number)} (auto — Minimum hours blank, net working time)`
                                : `${minEff}h`}
                          </p>
                          {breakTooLong ? (
                            <p id="preview_error" className="text-destructive">
                              Total break must be less than the shift duration.
                            </p>
                          ) : endBeforeStart ? (
                            <p id="preview_error" className="text-destructive">
                              End time must be later than start time, or enable Overnight.
                            </p>
                          ) : minExceedsNet ? (
                            <p id="preview_warn" className="text-amber-600">
                              Minimum hours exceeds net working time.
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="grace_minutes">Grace (min)</Label>
                        <Input id="grace_minutes" name="grace_minutes" type="number" min={0} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="overtime_after_minutes">Overtime after (min)</Label>
                        <Input
                          id="overtime_after_minutes"
                          name="overtime_after_minutes"
                          type="number"
                          min={0}
                        />
                        <p className="text-xs text-muted-foreground">
                          Overtime starts when worked time exceeds required hours by this amount.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="weekly_overtime_after_minutes">
                          Weekly overtime after (min)
                        </Label>
                        <Input
                          id="weekly_overtime_after_minutes"
                          name="weekly_overtime_after_minutes"
                          type="number"
                          min={0}
                        />
                        <p className="text-xs text-muted-foreground">
                          Extra minutes beyond the scheduled week before weekly overtime qualifies.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Working days</Label>
                      <div className="flex flex-wrap gap-2">
                        {DAY_LABELS.map((label, i) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() =>
                              setDays((d) =>
                                d.includes(i + 1) ? d.filter((x) => x !== i + 1) : [...d, i + 1],
                              )
                            }
                            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                              days.includes(i + 1)
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:bg-accent"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="shift-form" disabled={createShift.isPending}>
                      {createShift.isPending ? "Creating..." : "Create shift"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <UserPlus className="mr-2 h-4 w-4" /> Assign shift
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Assign shift to employee</DialogTitle>
                  </DialogHeader>
                  <form
                    id="assign-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      assign.mutate(Object.fromEntries(fd.entries()));
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label>Employee</Label>
                      <EmployeeSelect options={employees} name="employee_id" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Shift</Label>
                      <ShiftDefSelect
                        options={shifts.filter((s) => s.status === "active")}
                        name="shift_id"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="effective_from">Effective from</Label>
                      <Input
                        id="effective_from"
                        name="effective_from"
                        type="date"
                        defaultValue={new Date().toISOString().slice(0, 10)}
                        required
                      />
                    </div>
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="assign-form" disabled={assign.isPending}>
                      {assign.isPending ? "Assigning..." : "Assign"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active shifts"
          value={shifts.filter((s) => s.status === "active").length}
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <StatCard label="Employees assigned" value={employeesWithShifts.size} />
        <StatCard label="Active assignments" value={activeAssignments.length} />
      </div>

      {employee && myShift ? (
        <SectionCard title="My shift" className="mt-6">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <p className="font-medium">{myShift.name}</p>
            <p className="tabular-nums text-muted-foreground">
              {myShift.start_time.slice(0, 5)}–{myShift.end_time.slice(0, 5)}
              {myShift.overnight ? " (overnight)" : ""}
            </p>
            <p className="text-muted-foreground">{myShift.break_minutes} min break</p>
            <StatusBadge status={myShift.status} />
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Shift definitions" className="mt-6">
        {shifts.length === 0 ? (
          <EmptyState title="No shifts defined yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Shift</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead className="hidden md:table-cell">Break / Grace</TableHead>
                <TableHead className="hidden md:table-cell">Min / Half day</TableHead>
                <TableHead className="hidden lg:table-cell">Working days</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.code}</p>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                    {s.overnight ? <span className="ml-1 text-xs text-info">+1d</span> : null}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {s.break_minutes}m / {s.grace_minutes}m
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {s.minimum_hours}h / {s.half_day_hours}h
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {workingDaysLabel(s.days_of_week) || "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={deactivateShift.isPending}
                        onClick={() =>
                          deactivateShift.mutate({
                            id: s.id,
                            status: s.status === "active" ? "inactive" : "active",
                          })
                        }
                      >
                        {s.status === "active" ? "Deactivate" : "Activate"}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Assignments" className="mt-6">
        {assignments.length === 0 ? (
          <EmptyState title="No shift assignments yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Effective from</TableHead>
                <TableHead className="hidden md:table-cell">Ends</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{names.get(a.employee_id) ?? "—"}</TableCell>
                  <TableCell>{shiftNames.get(a.shift_id) ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{a.effective_from}</TableCell>
                  <TableCell className="hidden md:table-cell tabular-nums">
                    {a.effective_to ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={a.is_active ? "active" : "ended"} />
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {a.is_active ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={endAssignment.isPending}
                          onClick={() => endAssignment.mutate(a.id)}
                        >
                          End
                        </Button>
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
