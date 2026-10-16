import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
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

import { PageHeader, SectionCard, StatCard } from "@/components/hr/primitives";
import { ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { fetchDepartments, fetchEmployees, labelMap } from "@/lib/hr-queries";
import { canAccess } from "@/lib/rbac";

export const Route = createFileRoute("/_app/analytics")({
  head: () => ({
    meta: [
      { title: "Workforce Analytics — Spine AI" },
      {
        name: "description",
        content:
          "Headcount, attrition, attendance, leave and hiring analytics across your organization.",
      },
      { property: "og:title", content: "Workforce Analytics — Spine AI" },
      { property: "og:description", content: "Headcount, attendance, leave and hiring trends." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyticsPage,
});

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function AnalyticsPage() {
  const { roles, permissions } = useAuth();

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const departmentsQuery = useQuery({ queryKey: ["departments"], queryFn: fetchDepartments });
  const attendanceQuery = useQuery({
    queryKey: ["analytics-attendance"],
    queryFn: async () => {
      const since = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("attendance_records")
        .select("work_date, status, late_minutes, overtime_minutes")
        .gte("work_date", since);
      if (error) throw error;
      return data ?? [];
    },
  });
  const leaveQuery = useQuery({
    queryKey: ["analytics-leave"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select("start_date, days, status");
      if (error) throw error;
      return data ?? [];
    },
  });
  const reviewsQuery = useQuery({
    queryKey: ["analytics-reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_reviews")
        .select("rating, employee_id, status");
      if (error) throw error;
      return data ?? [];
    },
  });
  const ticketsQuery = useQuery({
    queryKey: ["analytics-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("helpdesk_tickets")
        .select("category, status, priority");
      if (error) throw error;
      return data ?? [];
    },
  });
  const expensesQuery = useQuery({
    queryKey: ["analytics-expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_requests")
        .select("category, amount, status");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!canAccess("analytics", roles, permissions))
    return <NoPermissionState what="workforce analytics" />;
  if (employeesQuery.isLoading || attendanceQuery.isLoading) return <LoadingState rows={8} />;
  if (employeesQuery.isError) return <ErrorState message="Unable to load analytics." />;

  const employees = employeesQuery.data ?? [];
  const depts = labelMap(departmentsQuery.data ?? []);
  const attendance = attendanceQuery.data ?? [];
  const leaves = leaveQuery.data ?? [];

  const byDept = [...depts.entries()].map(([id, name]) => ({
    name,
    headcount: employees.filter((e) => e.department_id === id).length,
  }));

  const byType = ["full_time", "part_time", "contract", "intern"]
    .map((t) => ({
      name: t.replace("_", " "),
      value: employees.filter((e) => e.employment_type === t).length,
    }))
    .filter((d) => d.value > 0);

  const hiringByMonth = monthSeries(
    employees.map((e) => e.joining_date),
    12,
  ).map((m) => ({
    month: m.label,
    hires: m.count,
  }));

  const attendanceByDay = groupBy(attendance, (a) => a.work_date)
    .map(([date, rows]) => ({
      date: date.slice(5),
      present: rows.filter((r) => r.status === "present").length,
      late: rows.filter((r) => r.status === "late").length,
      absent: rows.filter((r) => r.status === "absent").length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  const leaveByMonth = monthSeries(
    leaves.filter((l) => l.status === "approved").map((l) => l.start_date),
    12,
  ).map((m) => ({ month: m.label, days: m.count }));

  const presentRate = attendance.length
    ? Math.round(
        (attendance.filter((a) => a.status === "present").length / attendance.length) * 100,
      )
    : 0;
  const lateArrivals = attendance.filter((a) => a.status === "late").length;

  const reviews = reviewsQuery.data ?? [];
  const scored = reviews.filter((r) => r.rating != null);
  const avgRating = scored.length
    ? (scored.reduce((s, r) => s + Number(r.rating), 0) / scored.length).toFixed(2)
    : "—";
  const ratingByBucket = [1, 2, 3, 4, 5].map((n) => ({
    rating: n,
    count: scored.filter((r) => Math.round(Number(r.rating)) === n).length,
  }));

  const tickets = ticketsQuery.data ?? [];
  const ticketsByCategory = [...new Set(tickets.map((t) => t.category))].map((cat) => ({
    name: cat.replace("_", " "),
    open: tickets.filter((t) => t.category === cat && t.status !== "resolved").length,
    resolved: tickets.filter((t) => t.category === cat && t.status === "resolved").length,
  }));

  const expenses = expensesQuery.data ?? [];
  const expensesByCategory = [...new Set(expenses.map((e) => e.category))].map((cat) => ({
    name: cat.replace("_", " "),
    approved: expenses
      .filter((e) => e.category === cat && e.status === "approved")
      .reduce((s, e) => s + Number(e.amount ?? 0), 0),
    pending: expenses
      .filter((e) => e.category === cat && e.status === "pending")
      .reduce((s, e) => s + Number(e.amount ?? 0), 0),
  }));
  const openTickets = tickets.filter((t) => t.status !== "resolved").length;
  const approvedExpenses = expenses.filter((e) => e.status === "approved").length;

  return (
    <>
      <PageHeader
        title="Workforce Analytics"
        description="Trends across headcount, hiring, attendance and leave within your authorized scope."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Headcount"
          value={employees.filter((e) => e.employment_status !== "exited").length}
        />
        <StatCard label="Present rate (60d)" value={`${presentRate}%`} tone="success" />
        <StatCard label="Late arrivals (60d)" value={lateArrivals} tone="warning" />
        <StatCard
          label="Approved leave requests"
          value={leaves.filter((l) => l.status === "approved").length}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Avg review rating" value={avgRating} />
        <StatCard label="Reviews published" value={reviews.length} />
        <StatCard label="Open helpdesk tickets" value={openTickets} tone="warning" />
        <StatCard label="Expenses approved" value={approvedExpenses} tone="success" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Headcount by department">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={byDept}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis
                dataKey="name"
                fontSize={11}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={60}
              />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="headcount" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Employment type mix">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={byType}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={95}
                paddingAngle={3}
              >
                {byType.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Hiring trend (12 months)">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={hiringByMonth}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="hires"
                stroke="var(--color-chart-2)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Approved leave days by month">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={leaveByMonth}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="days" fill="var(--color-chart-4)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>

      <SectionCard title="Daily attendance (last 30 days)" className="mt-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={attendanceByDay}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
            <XAxis dataKey="date" fontSize={11} />
            <YAxis fontSize={11} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="present" stackId="a" fill="var(--color-chart-2)" />
            <Bar dataKey="late" stackId="a" fill="var(--color-chart-4)" />
            <Bar dataKey="absent" stackId="a" fill="var(--color-chart-5)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </SectionCard>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <SectionCard title="Rating distribution">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ratingByBucket}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="rating" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Helpdesk tickets by category">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ticketsByCategory}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis
                dataKey="name"
                fontSize={10}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={50}
              />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="open" stackId="a" fill="var(--color-chart-4)" />
              <Bar
                dataKey="resolved"
                stackId="a"
                fill="var(--color-chart-2)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Expense pipeline by category">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={expensesByCategory}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis
                dataKey="name"
                fontSize={10}
                interval={0}
                angle={-15}
                textAnchor="end"
                height={50}
              />
              <YAxis fontSize={11} />
              <Tooltip />
              <Bar dataKey="approved" stackId="a" fill="var(--color-chart-2)" />
              <Bar
                dataKey="pending"
                stackId="a"
                fill="var(--color-chart-5)"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
    </>
  );
}

function groupBy<T>(rows: T[], key: (row: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  rows.forEach((r) => {
    const k = key(r);
    const list = map.get(k) ?? [];
    list.push(r);
    map.set(k, list);
  });
  return [...map.entries()];
}

function monthSeries(dates: (string | null)[], months: number) {
  const now = new Date();
  const buckets: { label: string; key: string; count: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      label: d.toLocaleString("en", { month: "short" }),
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      count: 0,
    });
  }
  dates.forEach((d) => {
    if (!d) return;
    const bucket = buckets.find((b) => d.startsWith(b.key));
    if (bucket) bucket.count += 1;
  });
  return buckets;
}
