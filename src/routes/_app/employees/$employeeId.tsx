import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

/* eslint-disable @typescript-eslint/no-explicit-any */

type LifecycleEvent = {
  id: string;
  event_type: string;
  effective_date: string;
  previous_value: Record<string, string> | null;
  new_value: Record<string, string> | null;
  reason: string | null;
  actor: string | null;
  created_at: string;
};

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/hr/primitives";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { daysUntil, fetchDepartments, fetchLocations, labelMap } from "@/lib/hr-queries";

export const Route = createFileRoute("/_app/employees/$employeeId")({
  head: () => ({
    meta: [
      { title: "Employee 360 — Spine AI" },
      {
        name: "description",
        content:
          "A complete employee view: profile, attendance, leave, performance, documents, career and activity.",
      },
      { property: "og:title", content: "Employee 360 — Spine AI" },
      { property: "og:description", content: "One connected view of an employee." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Employee360,
});

function Employee360() {
  const { employeeId } = Route.useParams();

  const employeeQuery = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("*")
        .eq("id", employeeId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const departmentsQuery = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const locationsQuery = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });

  const attendanceQuery = useQuery({
    queryKey: ["employee-attendance", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("work_date, status, late_minutes, overtime_minutes")
        .eq("employee_id", employeeId)
        .order("work_date", { ascending: false })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
  });

  const leaveQuery = useQuery({
    queryKey: ["employee-leave", employeeId],
    queryFn: async () => {
      const [requests, balances] = await Promise.all([
        supabase
          .from("leave_requests")
          .select("id, start_date, end_date, days, status, reason, leave_type_id")
          .eq("employee_id", employeeId)
          .order("start_date", { ascending: false }),
        supabase
          .from("leave_balances")
          .select("id, entitled, used, leave_type_id")
          .eq("employee_id", employeeId),
      ]);
      const { data: types } = await supabase.from("leave_types").select("id, name");
      return {
        requests: requests.data ?? [],
        balances: balances.data ?? [],
        types: new Map((types ?? []).map((t) => [t.id, t.name])),
      };
    },
  });

  const performanceQuery = useQuery({
    queryKey: ["employee-performance", employeeId],
    queryFn: async () => {
      const [goals, reviews] = await Promise.all([
        supabase.from("goals").select("*").eq("employee_id", employeeId).order("due_date"),
        supabase
          .from("performance_reviews")
          .select("*")
          .eq("employee_id", employeeId)
          .order("created_at", { ascending: false }),
      ]);
      return { goals: goals.data ?? [], reviews: reviews.data ?? [] };
    },
  });

  const documentsQuery = useQuery({
    queryKey: ["employee-documents", employeeId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_documents")
        .select("*")
        .eq("employee_id", employeeId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const lifecycleQuery = useQuery({
    queryKey: ["employee-lifecycle", employeeId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("employee_lifecycle_events") as any)
        .select(
          "id, event_type, effective_date, previous_value, new_value, reason, actor, created_at",
        )
        .eq("employee_id", employeeId)
        .order("effective_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LifecycleEvent[];
    },
  });

  const activityQuery = useQuery({
    queryKey: ["employee-activity", employeeId],
    queryFn: async () => {
      const { data } = await supabase
        .from("onboarding_tasks")
        .select("id, title, status, due_date")
        .eq("employee_id", employeeId)
        .order("due_date");
      return data ?? [];
    },
  });

  if (employeeQuery.isLoading) return <LoadingState rows={8} />;
  if (employeeQuery.isError) return <ErrorState message="Unable to load this employee." />;
  const employee = employeeQuery.data;
  if (!employee) return <NoPermissionState what="this employee record" />;

  const deptNames = labelMap(departmentsQuery.data ?? []);
  const locNames = labelMap(locationsQuery.data ?? []);
  const attendance = attendanceQuery.data ?? [];
  const present = attendance.filter((a) => a.status === "present").length;
  const late = attendance.filter((a) => a.status === "late").length;
  const absent = attendance.filter((a) => a.status === "absent").length;
  const overtime = attendance.reduce((s, a) => s + (a.overtime_minutes ?? 0), 0);
  const attendancePct = attendance.length
    ? Math.round(((present + late) / attendance.length) * 100)
    : 0;

  const goals = performanceQuery.data?.goals ?? [];
  const reviews = performanceQuery.data?.reviews ?? [];
  const dueSoonGoals = goals.filter((g) => {
    const d = daysUntil(g.due_date);
    return g.status !== "completed" && d !== null && d >= 0 && d <= 21;
  }).length;
  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + Number(r.rating ?? 0), 0) / reviews.length).toFixed(1)
    : "—";

  const aiSummary = [
    `Attendance over the last ${attendance.length} recorded days is ${attendancePct}% with ${late} late arrival${late === 1 ? "" : "s"} and ${absent} absence${absent === 1 ? "" : "s"}.`,
    goals.length
      ? `${goals.filter((g) => g.status === "completed").length} of ${goals.length} goals are complete${dueSoonGoals ? `, and ${dueSoonGoals} are approaching their deadline` : ""}.`
      : "No performance goals are currently recorded.",
    reviews.length
      ? `Average review rating is ${avgRating} across ${reviews.length} review(s).`
      : "No published reviews yet.",
  ].join(" ");

  return (
    <>
      <PageHeader
        title={`${employee.first_name} ${employee.last_name}`}
        description={`${employee.employee_code} · ${employee.designation ?? "—"} · ${deptNames.get(employee.department_id ?? "") ?? "—"}`}
        actions={<StatusBadge status={employee.employment_status} />}
      />

      <SectionCard className="ai-surface mb-6">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="font-semibold">AI employee summary</p>
            <p className="mt-1 text-sm text-muted-foreground">{aiSummary}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Generated from the records you are authorized to see. Facts only — no recommendation
              implied.
            </p>
          </div>
        </div>
      </SectionCard>

      <Tabs defaultValue="overview">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="career">Career</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-3">
          <SectionCard title="Contact">
            <dl className="space-y-2 text-sm">
              <Row label="Work email" value={employee.work_email} />
              <Row label="Phone" value={employee.phone} />
              <Row label="Emergency contact" value={employee.emergency_contact} />
            </dl>
          </SectionCard>
          <SectionCard title="Organization">
            <dl className="space-y-2 text-sm">
              <Row label="Department" value={deptNames.get(employee.department_id ?? "") ?? null} />
              <Row label="Location" value={locNames.get(employee.location_id ?? "") ?? null} />
              <Row label="Manager" value={employee.manager_id ? "Assigned" : "—"} />
            </dl>
          </SectionCard>
          <SectionCard title="Employment">
            <dl className="space-y-2 text-sm">
              <Row label="Joining date" value={employee.joining_date} />
              <Row
                label="Employment type"
                value={employee.employment_type?.replace("_", " ") ?? null}
              />
              <Row label="Probation ends" value={employee.probation_end_date ?? "—"} />
            </dl>
          </SectionCard>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Attendance"
              value={`${attendancePct}%`}
              hint={`${attendance.length} recorded days`}
            />
            <StatCard label="Present" value={present} tone="success" />
            <StatCard label="Late" value={late} tone="warning" />
            <StatCard label="Absent" value={absent} tone="destructive" />
          </div>
          <SectionCard
            title="Recent attendance"
            description={`Overtime logged: ${Math.round(overtime / 60)} hours`}
          >
            {attendance.length === 0 ? (
              <EmptyState title="No attendance records." />
            ) : (
              <div className="max-h-96 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Late (min)</TableHead>
                      <TableHead>Overtime (min)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendance.slice(0, 30).map((a) => (
                      <TableRow key={a.work_date}>
                        <TableCell>{a.work_date}</TableCell>
                        <TableCell>
                          <StatusBadge status={a.status} />
                        </TableCell>
                        <TableCell>{a.late_minutes}</TableCell>
                        <TableCell>{a.overtime_minutes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="leave" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(leaveQuery.data?.balances ?? []).map((b) => (
              <StatCard
                key={b.id}
                label={leaveQuery.data?.types.get(b.leave_type_id) ?? "Leave"}
                value={`${Number(b.entitled) - Number(b.used)} left`}
                hint={`${b.used} used of ${b.entitled}`}
              />
            ))}
          </div>
          <SectionCard title="Leave history">
            {(leaveQuery.data?.requests ?? []).length === 0 ? (
              <EmptyState title="No leave requests." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(leaveQuery.data?.requests ?? []).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{leaveQuery.data?.types.get(r.leave_type_id) ?? "—"}</TableCell>
                      <TableCell>
                        {r.start_date} → {r.end_date}
                      </TableCell>
                      <TableCell>{r.days}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="performance" className="mt-4 space-y-4">
          <SectionCard title="Goals">
            {goals.length === 0 ? (
              <EmptyState title="No goals set." />
            ) : (
              <ul className="space-y-4">
                {goals.map((g) => (
                  <li key={g.id}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium">{g.title}</p>
                      <StatusBadge status={g.status} />
                    </div>
                    <p className="text-sm text-muted-foreground">{g.description}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <Progress value={g.progress} className="h-2" />
                      <span className="text-xs text-muted-foreground">
                        {g.progress}% · due {g.due_date}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Reviews" description={`Average rating ${avgRating}`}>
            {reviews.length === 0 ? (
              <EmptyState title="No reviews yet." />
            ) : (
              <ul className="space-y-4">
                {reviews.map((r) => (
                  <li key={r.id} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{r.period}</p>
                      <Badge variant="secondary">Rating {r.rating}</Badge>
                    </div>
                    <p className="mt-2 text-sm">
                      <span className="font-medium">Strengths: </span>
                      {r.strengths}
                    </p>
                    <p className="text-sm">
                      <span className="font-medium">Development: </span>
                      {r.improvements}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{r.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          <SectionCard title="Documents">
            {(documentsQuery.data ?? []).length === 0 ? (
              <EmptyState title="No documents uploaded." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Verification</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(documentsQuery.data ?? []).map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.name}</TableCell>
                      <TableCell className="capitalize">{d.category.replace("_", " ")}</TableCell>
                      <TableCell>{d.expiry_date ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={d.verification_status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="career" className="mt-4">
          <SectionCard title="Career" description="Role history and recorded lifecycle events">
            <ol className="relative space-y-4 border-l pl-5">
              {(lifecycleQuery.data ?? []).map((e) => (
                <li key={e.id} className="relative">
                  <span
                    className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary"
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-center justify-between gap-x-3">
                    <p className="font-medium">{lifecycleLabel(e.event_type)}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{e.effective_date}</span>
                      <StatusBadge status={e.event_type} />
                    </div>
                  </div>
                  {e.new_value && typeof e.new_value === "object" ? (
                    <p className="text-sm text-muted-foreground">
                      {lifecycleValue(e.previous_value)} → {lifecycleValue(e.new_value)}
                    </p>
                  ) : null}
                  {e.reason ? <p className="text-sm text-muted-foreground">{e.reason}</p> : null}
                </li>
              ))}
              <li>
                <p className="font-medium">{employee.designation ?? "Employee"}</p>
                <p className="text-sm text-muted-foreground">Since {employee.joining_date}</p>
              </li>
              {employee.probation_end_date ? (
                <li>
                  <p className="font-medium">Probation review</p>
                  <p className="text-sm text-muted-foreground">
                    Scheduled for {employee.probation_end_date}
                  </p>
                </li>
              ) : null}
            </ol>
          </SectionCard>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <SectionCard title="HR activity" description="Onboarding and workflow events">
            {(activityQuery.data ?? []).length === 0 ? (
              <EmptyState title="No recorded HR activity." />
            ) : (
              <ul className="space-y-3">
                {(activityQuery.data ?? []).map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">Due {t.due_date}</p>
                    </div>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value || "—"}</dd>
    </div>
  );
}

function lifecycleLabel(type: string) {
  return (
    {
      hired: "Joined the team",
      promoted: "Promotion",
      transferred: "Transferred",
      updated: "Record updated",
      terminated: "Employment ended",
      offboarded: "Offboarded",
    }[type] ?? "Lifecycle event"
  );
}

function lifecycleValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return lifecycleValue(parsed);
    } catch {
      return value;
    }
  }
  if (Array.isArray(value) || typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts =
      record["designation"] ??
      record["department"] ??
      record["title"] ??
      record["department_id"] ??
      record["location"];
    if (Array.isArray(parts)) return parts.join(" → ");
    if (parts != null && parts !== "") return String(parts);
    return Object.entries(record)
      .filter(([, v]) => v != null && v !== "")
      .map(([, v]) => String(v))
      .join(" → ");
  }
  return String(value);
}
