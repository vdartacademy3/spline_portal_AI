import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  CalendarDays,
  ClipboardCheck,
  FileWarning,
  Search,
  TimerReset,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/hr/primitives";
import { useGlobalSearch } from "@/components/hr/global-search-context";
import { ErrorState, LoadingState } from "@/components/hr/states";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { daysUntil, fetchDepartments, fetchEmployees } from "@/lib/hr-queries";
import { isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({
    meta: [
      { title: "Workforce Dashboard — Spine AI" },
      {
        name: "description",
        content:
          "Live headcount, attendance, leave, hiring and AI insights for your authorized part of the organization.",
      },
      { property: "og:title", content: "Workforce Dashboard — Spine AI" },
      { property: "og:description", content: "Workforce KPIs and AI insights in one view." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function DashboardPage() {
  const { roles, fullName, employee } = useAuth();
  const { openSearch } = useGlobalSearch();
  const hr = isHr(roles);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const departmentsQuery = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });

  const leaveQuery = useQuery({
    queryKey: ["leave-requests-dash"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("id, employee_id, status, start_date, end_date, days, created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const attendanceQuery = useQuery({
    queryKey: ["attendance-dash"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("attendance_records")
        .select("employee_id, work_date, status, late_minutes")
        .gte("work_date", since);
      if (error) throw error;
      return data ?? [];
    },
  });

  const jobsQuery = useQuery({
    queryKey: ["jobs-dash"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_requisitions")
        .select("id, title, status, openings, created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const candidatesQuery = useQuery({
    queryKey: ["candidates-dash"],
    enabled: hr,
    queryFn: async () => {
      const { data, error } = await supabase.from("candidates").select("id, stage");
      if (error) throw error;
      return data ?? [];
    },
  });

  const documentsQuery = useQuery({
    queryKey: ["documents-dash"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_documents")
        .select("id, name, expiry_date, employee_id");
      if (error) throw error;
      return data ?? [];
    },
  });

  const insightsQuery = useQuery({
    queryKey: ["ai-insights"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_insights")
        .select("id, title, detail, severity, recommended_action, link")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const reviewsQuery = useQuery({
    queryKey: ["reviews-dash"],
    queryFn: async () => {
      const { data, error } = await supabase.from("performance_reviews").select("id, rating");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (employeesQuery.isLoading || attendanceQuery.isLoading) {
    return (
      <>
        <PageHeader title="Dashboard" description="Loading your workforce overview" />
        <LoadingState rows={6} />
      </>
    );
  }
  if (employeesQuery.isError) return <ErrorState message="Workforce data could not be loaded." />;

  const employees = employeesQuery.data ?? [];
  const departments = departmentsQuery.data ?? [];
  const leaves = leaveQuery.data ?? [];
  const attendance = attendanceQuery.data ?? [];
  const jobs = jobsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const onLeaveToday = leaves.filter(
    (l) => l.status === "approved" && l.start_date <= today && l.end_date >= today,
  ).length;
  const pendingLeave = leaves.filter((l) => l.status === "pending").length;
  const newJoiners = employees.filter(
    (e) => new Date(e.joining_date).getTime() > Date.now() - 90 * 86_400_000,
  ).length;
  const probationSoon = employees.filter((e) => {
    const d = daysUntil(e.probation_end_date);
    return d !== null && d >= 0 && d <= 60;
  }).length;
  const expiringDocs = documents.filter((d) => {
    const days = daysUntil(d.expiry_date);
    return days !== null && days >= 0 && days <= 30;
  }).length;
  const lateByEmployee = new Map<string, number>();
  attendance
    .filter((a) => a.status === "late")
    .forEach((a) =>
      lateByEmployee.set(a.employee_id, (lateByEmployee.get(a.employee_id) ?? 0) + 1),
    );
  const attendanceIssues = [...lateByEmployee.values()].filter((v) => v >= 3).length;
  const openPositions = jobs
    .filter((j) => j.status === "open")
    .reduce((sum, j) => sum + (j.openings ?? 1), 0);

  // Charts
  const headcountTrend = Array.from({ length: 6 }).map((_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i), 1);
    const label = d.toLocaleString("en", { month: "short" });
    const count = employees.filter((e) => new Date(e.joining_date) <= d).length;
    return { month: label, headcount: count };
  });

  const deptDistribution = departments.map((d) => ({
    name: d.name,
    value: employees.filter((e) => e.department_id === d.id).length,
  }));

  const attendanceTrend = (() => {
    const byDay = new Map<string, { present: number; late: number; absent: number }>();
    attendance.forEach((a) => {
      const row = byDay.get(a.work_date) ?? { present: 0, late: 0, absent: 0 };
      if (a.status === "present") row.present += 1;
      else if (a.status === "late") row.late += 1;
      else row.absent += 1;
      byDay.set(a.work_date, row);
    });
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, v]) => ({ date: date.slice(5), ...v }));
  })();

  const pipeline = (() => {
    const stages = ["applied", "screening", "interview", "evaluation", "offer", "hired"];
    const rows = candidatesQuery.data ?? [];
    return stages.map((s) => ({ stage: s, count: rows.filter((c) => c.stage === s).length }));
  })();

  const ratingDistribution = (() => {
    const buckets = [
      { band: "< 3", min: 0, max: 3 },
      { band: "3 – 3.5", min: 3, max: 3.5 },
      { band: "3.5 – 4", min: 3.5, max: 4 },
      { band: "4 – 4.5", min: 4, max: 4.5 },
      { band: "4.5+", min: 4.5, max: 6 },
    ];
    const rows = reviewsQuery.data ?? [];
    return buckets.map((b) => ({
      band: b.band,
      count: rows.filter((r) => (r.rating ?? 0) >= b.min && (r.rating ?? 0) < b.max).length,
    }));
  })();

  const scopeNote = hr
    ? "Organization-wide view"
    : employee
      ? "Scoped to you and your team"
      : "Scoped to your own information";

  return (
    <>
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <button
          type="button"
          onClick={openSearch}
          className="flex h-9 w-full max-w-[480px] shrink-0 items-center gap-2 rounded-lg border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent md:w-[440px] xl:w-[480px]"
        >
          <Search className="h-4 w-4" aria-hidden />
          <span className="truncate">Search employees, jobs, tickets...</span>
          <kbd className="ml-auto hidden rounded border px-1.5 text-[10px] sm:inline">⌘K</kbd>
        </button>

        <div className="min-w-0 md:text-right">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back, {fullName.split(" ")[0] || "there"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {scopeNote} · {new Date().toLocaleDateString("en", { dateStyle: "full" })}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total employees"
          value={employees.length}
          icon={<Users className="h-4 w-4" />}
          hint={`${departments.length} departments`}
        />
        <StatCard
          label="New joiners (90d)"
          value={newJoiners}
          icon={<UserPlus className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="On leave today"
          value={onLeaveToday}
          icon={<CalendarDays className="h-4 w-4" />}
        />
        <StatCard
          label="Attendance issues"
          value={attendanceIssues}
          hint="3+ late days in 30 days"
          icon={<ClipboardCheck className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Open positions"
          value={openPositions}
          icon={<UserPlus className="h-4 w-4" />}
        />
        <StatCard
          label="Pending approvals"
          value={pendingLeave}
          hint="Leave requests"
          icon={<TimerReset className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Probation ending"
          value={probationSoon}
          hint="Next 60 days"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="warning"
        />
        <StatCard
          label="Documents expiring"
          value={expiringDocs}
          hint="Next 30 days"
          icon={<FileWarning className="h-4 w-4" />}
          tone="destructive"
        />
      </div>

      {insightsQuery.data?.length ? (
        <SectionCard
          className="mt-6 ai-surface"
          title="AI insights"
          description="Generated from your authorized workforce data"
        >
          <div className="grid gap-3 md:grid-cols-2">
            {insightsQuery.data.map((i) => (
              <div key={i.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{i.title}</p>
                  <StatusBadge status={i.severity} />
                </div>
                {i.detail ? <p className="mt-1 text-sm text-muted-foreground">{i.detail}</p> : null}
                {i.recommended_action ? (
                  <p className="mt-2 text-sm">
                    <span className="font-medium">Recommended: </span>
                    {i.recommended_action}
                  </p>
                ) : null}
                {i.link ? (
                  <Button asChild variant="link" className="mt-1 h-auto p-0">
                    <Link to={i.link as "/dashboard"}>View details</Link>
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Headcount trend" description="Last 6 months">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={headcountTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" stroke="var(--color-muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Area
                dataKey="headcount"
                stroke="var(--color-chart-1)"
                fill="var(--color-chart-1)"
                fillOpacity={0.15}
              />
            </AreaChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Department distribution">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={deptDistribution}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={2}
              >
                {deptDistribution.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {deptDistribution.map((d, i) => (
              <span key={d.name} className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                {d.name} ({d.value})
              </span>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Attendance trend" description="Last 14 working days">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={attendanceTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Line dataKey="present" stroke="var(--color-chart-3)" dot={false} strokeWidth={2} />
              <Line dataKey="late" stroke="var(--color-chart-4)" dot={false} strokeWidth={2} />
              <Line dataKey="absent" stroke="var(--color-chart-5)" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title={hr ? "Hiring pipeline" : "Performance distribution"}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hr ? pipeline : ratingDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                dataKey={hr ? "stage" : "band"}
                stroke="var(--color-muted-foreground)"
                fontSize={12}
              />
              <YAxis stroke="var(--color-muted-foreground)" fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
    </>
  );
}
