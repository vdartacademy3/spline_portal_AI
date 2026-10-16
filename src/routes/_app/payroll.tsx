import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Banknote, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader, SectionCard, StatCard, StatusBadge } from "@/components/hr/primitives";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "@/components/hr/states";
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
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getDocumentUrl, uploadEmployeeDocument } from "@/lib/documents.functions";
import { fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, hasPermission, isHr } from "@/lib/rbac";
import { buildPayslipPdf, bytesToBase64 } from "@/lib/payslip";

export const Route = createFileRoute("/_app/payroll")({
  head: () => ({
    meta: [
      { title: "Payroll — Spine AI" },
      {
        name: "description",
        content:
          "Salary structures and payroll runs. Compensation data is restricted to HR and your own payslips.",
      },
      { property: "og:title", content: "Payroll — Spine AI" },
      { property: "og:description", content: "Salary structures and payroll runs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PayrollPage,
});

function jsonNumber(value: Json | null): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value !== "object" || Array.isArray(value)) return 0;
  const entries = Object.values(value as Record<string, unknown>);
  const first = entries.find((e): e is number => typeof e === "number");
  return first ?? 0;
}

function PayrollPage() {
  const { roles, permissions, user, employee } = useAuth();
  const queryClient = useQueryClient();
  const hr = isHr(roles);
  const canManage = hasPermission(roles, permissions, "manage_payroll");
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const salariesQuery = useQuery({
    queryKey: ["salaries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_salaries")
        .select("*")
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const runsQuery = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_runs")
        .select("*")
        .order("period_start", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const entriesQuery = useQuery({
    queryKey: ["payroll-entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_entries")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const payslipDocsQuery = useQuery({
    queryKey: ["payslip-docs", employee?.id],
    enabled: !!employee && !hr,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_documents")
        .select("id, employee_id, name, category, created_at")
        .eq("category", "payslip")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).filter((d) => d.employee_id === employee?.id);
    },
  });

  const addSalary = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { data, error } = await supabase
        .from("employee_salaries")
        .insert({
          employee_id: String(form["employee_id"]),
          effective_from: String(form["effective_from"]),
          basic: Number(form["basic"]) || 0,
          allowances: { value: Number(form["allowances"]) || 0 } as never,
          deductions: { value: Number(form["deductions"]) || 0 } as never,
          currency: String(form["currency"] ?? "USD") || "USD",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "payroll.salary_set",
        entity: "employee_salaries",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Salary structure saved");
      setSalaryOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["salaries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The salary could not be saved."),
  });

  const createRun = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const salaries = salariesQuery.data ?? [];
      if (!salaries.length) throw new Error("Add at least one salary structure first.");

      const { data: run, error: runError } = await supabase
        .from("payroll_runs")
        .insert({
          period_start: String(form["period_start"]),
          period_end: String(form["period_end"]),
          status: "draft",
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (runError) throw runError;

      const entries = salaries.map((s) => {
        const basic = Number(s.basic ?? 0);
        const allowances = jsonNumber(s.allowances);
        const deductions = jsonNumber(s.deductions);
        const gross = basic + allowances;
        return {
          run_id: run.id,
          employee_id: s.employee_id,
          basic,
          allowances,
          deductions,
          gross,
          net: gross - deductions,
          status: "draft",
        };
      });
      const { error: entriesError } = await supabase.from("payroll_entries").insert(entries);
      if (entriesError) throw entriesError;

      await logAudit({
        userId: user?.id,
        action: "payroll.run_created",
        entity: "payroll_runs",
        entityId: run.id,
      });
    },
    onSuccess: () => {
      toast.success("Payroll run created");
      setRunOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The run could not be created."),
  });

  const advanceRun = useMutation({
    mutationFn: async ({ id, to }: { id: string; to: "processed" | "paid" }) => {
      if (to === "processed") {
        const { error } = await supabase
          .from("payroll_runs")
          .update({ status: "processed", processed_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
        await logAudit({
          userId: user?.id,
          action: "payroll.run_processed",
          entity: "payroll_runs",
          entityId: id,
        });
        return { payslips: 0, failed: 0 };
      }

      const { error } = await supabase
        .from("payroll_runs")
        .update({
          status: "paid",
          paid_at: new Date().toISOString(),
          paid_by: user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
      const { error: entriesError } = await supabase
        .from("payroll_entries")
        .update({ status: "paid" })
        .eq("run_id", id);
      if (entriesError) throw entriesError;

      await logAudit({
        userId: user?.id,
        action: "payroll.run_paid",
        entity: "payroll_runs",
        entityId: id,
      });

      const { data: runRow } = await supabase
        .from("payroll_runs")
        .select("period_start, period_end")
        .eq("id", id)
        .single();
      const { data: paidEntries } = await supabase
        .from("payroll_entries")
        .select("employee_id, basic, allowances, deductions, gross, net")
        .eq("run_id", id);
      const { data: emps } = await supabase
        .from("employees")
        .select("id, employee_code, first_name, last_name");
      const { data: salaryRows } = await supabase
        .from("employee_salaries")
        .select("employee_id, currency");

      const empById = new Map((emps ?? []).map((e) => [e.id, e]));
      const currencyById = new Map(
        (salaryRows ?? []).map((s) => [s.employee_id, s.currency ?? "USD"]),
      );
      const period = `${runRow?.period_start ?? ""} – ${runRow?.period_end ?? ""}`;

      let payslips = 0;
      let failed = 0;
      for (const e of paidEntries ?? []) {
        const emp = empById.get(e.employee_id);
        if (!emp) continue;
        try {
          const pdf = buildPayslipPdf({
            employeeName: `${emp.first_name} ${emp.last_name}`,
            employeeCode: emp.employee_code,
            period,
            basic: Number(e.basic ?? 0),
            allowances: Number(e.allowances ?? 0),
            deductions: Number(e.deductions ?? 0),
            gross: Number(e.gross ?? 0),
            net: Number(e.net ?? 0),
            currency: currencyById.get(e.employee_id) ?? "USD",
          });
          await uploadEmployeeDocument({
            data: {
              employeeId: e.employee_id,
              name: `Payslip ${period}`,
              category: "payslip",
              expiryDate: null,
              fileName: `payslip-${emp.employee_code}-${runRow?.period_start ?? ""}.pdf`,
              contentType: "application/pdf",
              fileBase64: bytesToBase64(pdf),
            },
          });
          payslips += 1;
        } catch {
          failed += 1;
        }
      }
      return { payslips, failed };
    },
    onSuccess: (result, vars) => {
      toast.success(
        vars.to === "paid"
          ? `Payroll run paid — ${result.payslips} payslip(s) generated${
              result.failed ? `, ${result.failed} failed` : ""
            }`
          : "Payroll run updated",
      );
      void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
      void queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      void queryClient.invalidateQueries({ queryKey: ["payslip-docs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The run could not be updated."),
  });

  const saveEntry = useMutation({
    mutationFn: async ({ id, form }: { id: string; form: Record<string, FormDataEntryValue> }) => {
      const basic = Number(form["basic"]) || 0;
      const allowances = Number(form["allowances"]) || 0;
      const deductions = Number(form["deductions"]) || 0;
      const { error } = await supabase
        .from("payroll_entries")
        .update({
          basic,
          allowances,
          deductions,
          gross: basic + allowances,
          net: basic + allowances - deductions,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success("Entry updated");
      void queryClient.invalidateQueries({ queryKey: ["payroll-entries"] });
      void v.id;
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : "Entries can only be edited while the run is in draft.",
      ),
  });

  if (!canAccess("payroll", roles, permissions))
    return <NoPermissionState what="payroll information" />;
  if (runsQuery.isLoading) return <LoadingState rows={6} />;
  if (runsQuery.isError) return <ErrorState message="Unable to load payroll data." />;

  const names = nameMap(employeesQuery.data ?? []);
  const salaries = salariesQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const entries = entriesQuery.data ?? [];
  const runById = new Map(runs.map((r) => [r.id, r]));
  // Server-side scoping already limits these queries to the caller's own rows;
  // the client-side filter is defence in depth so no other employee can ever be
  // rendered in the self-service view.
  const mine = employee ? entries.filter((e) => e.employee_id === employee.id) : [];
  const visibleEntries = hr ? entries : mine;
  const mySalaries = employee ? salaries.filter((s) => s.employee_id === employee.id) : [];
  const visibleSalaries = hr ? salaries : mySalaries;
  const monthCost = visibleEntries
    .filter((e) => e.status !== "cancelled")
    .reduce((s, e) => s + Number(e.net ?? 0), 0);

  const formatMoney = (amount: number, currency = "USD") => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
  };

  const downloadPayslip = async (id: string, name: string) => {
    try {
      const { url } = await getDocumentUrl({ data: { id } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error(`"${name}" could not be downloaded.`);
    }
  };

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Salary structures and payroll runs. Compensation is visible to HR; employees see only their own paid payslips."
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Dialog open={salaryOpen} onOpenChange={setSalaryOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Plus className="mr-2 h-4 w-4" /> Salary
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Set salary structure</DialogTitle>
                  </DialogHeader>
                  <form
                    id="salary-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      addSalary.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label>Employee</Label>
                      <Select name="employee_id">
                        <SelectTrigger>
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {(employeesQuery.data ?? []).map((emp) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {`${emp.first_name} ${emp.last_name}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="basic">Basic</Label>
                        <Input id="basic" name="basic" type="number" min={0} step="0.01" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="effective_from">Effective from</Label>
                        <Input id="effective_from" name="effective_from" type="date" required />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="allowances">Allowances</Label>
                        <Input
                          id="allowances"
                          name="allowances"
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue="0"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="deductions">Deductions</Label>
                        <Input
                          id="deductions"
                          name="deductions"
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue="0"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="currency">Currency</Label>
                      <Input id="currency" name="currency" defaultValue="USD" />
                    </div>
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="salary-form" disabled={addSalary.isPending}>
                      {addSalary.isPending ? "Saving..." : "Save salary"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={runOpen} onOpenChange={setRunOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" /> Create run
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create payroll run</DialogTitle>
                  </DialogHeader>
                  <form
                    id="run-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      createRun.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
                    }}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="period_start">Period start</Label>
                        <Input id="period_start" name="period_start" type="date" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="period_end">Period end</Label>
                        <Input id="period_end" name="period_end" type="date" required />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Generates entries for {salaries.length} salary structure(s).
                    </p>
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="run-form" disabled={createRun.isPending}>
                      {createRun.isPending ? "Creating..." : "Create run"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={hr ? "Salary structures" : "My salary structure"}
          value={visibleSalaries.length}
          icon={<Banknote className="h-4 w-4" />}
        />
        <StatCard label={hr ? "Runs" : "My pay periods"} value={runs.length} />
        <StatCard label={hr ? "Entries" : "My payroll records"} value={visibleEntries.length} />
        <StatCard
          label={hr ? "Net this run" : "My net pay"}
          value={formatMoney(monthCost)}
          tone="success"
        />
      </div>

      {!hr ? (
        <SectionCard title="My salary" className="mt-6">
          {mySalaries.length === 0 ? (
            <EmptyState
              title="No salary structure on record."
              description="Your salary details appear here once HR publishes them."
            />
          ) : (
            <ul className="space-y-3">
              {mySalaries.map((s) => (
                <li key={s.id} className="rounded-lg border p-4">
                  <p className="font-medium">
                    Effective from <span className="text-muted-foreground">{s.effective_from}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Basic {formatMoney(Number(s.basic ?? 0), s.currency ?? "USD")} · allowances{" "}
                    {formatMoney(jsonNumber(s.allowances), s.currency ?? "USD")} · deductions{" "}
                    {formatMoney(jsonNumber(s.deductions), s.currency ?? "USD")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : null}

      {canManage ? (
        <SectionCard title="Salary structures" className="mt-6">
          {salaries.length === 0 ? (
            <EmptyState title="No salary structures yet." />
          ) : (
            <ul className="space-y-3">
              {salaries.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">
                      {names.get(s.employee_id) ?? "—"}{" "}
                      <span className="text-muted-foreground">· since {s.effective_from}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Basic {formatMoney(Number(s.basic ?? 0), s.currency ?? "USD")} · allowances{" "}
                      {formatMoney(jsonNumber(s.allowances), s.currency ?? "USD")} · deductions{" "}
                      {formatMoney(jsonNumber(s.deductions), s.currency ?? "USD")}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      ) : null}

      <SectionCard title={hr ? "Payroll runs" : "My payslips"} className="mt-6">
        <ul className="space-y-4">
          {runs.length === 0 ? (
            <EmptyState
              title={hr ? "No payroll runs yet." : "No payslips yet."}
              {...(hr ? { description: "Create a run from salary structures." } : {})}
            />
          ) : (
            runs.map((r) => {
              const runEntries = visibleEntries.filter((e) => e.run_id === r.id);
              const total = runEntries.reduce((s, e) => s + Number(e.net ?? 0), 0);
              return (
                <li key={r.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <p className="font-medium">
                          {r.period_start} → {r.period_end}
                        </p>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {runEntries.length} entries{hr ? ` · net ${formatMoney(total)}` : ""}
                      </p>
                    </div>
                    {hr ? (
                      <div className="flex shrink-0 gap-2">
                        {r.status === "draft" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => advanceRun.mutate({ id: r.id, to: "processed" })}
                          >
                            Process
                          </Button>
                        ) : null}
                        {r.status === "processed" ? (
                          <Button
                            size="sm"
                            onClick={() => advanceRun.mutate({ id: r.id, to: "paid" })}
                          >
                            Pay
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {runEntries.length ? (
                    <ul className="mt-3 space-y-2">
                      {runEntries.map((e) => (
                        <li
                          key={e.id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                        >
                          <span className="font-medium">{names.get(e.employee_id) ?? "—"}</span>
                          {hr ? (
                            <span className="text-xs text-muted-foreground">
                              basic {formatMoney(Number(e.basic ?? 0))} · net{" "}
                              {formatMoney(Number(e.net ?? 0))}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              gross {formatMoney(Number(e.gross ?? 0))} · deductions{" "}
                              {formatMoney(Number(e.deductions ?? 0))} · net{" "}
                              {formatMoney(Number(e.net ?? 0))}
                            </span>
                          )}
                          <StatusBadge status={e.status} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })
          )}
        </ul>
        {!hr && (payslipDocsQuery.data ?? []).length ? (
          <div className="mt-5 border-t pt-4">
            <p className="mb-3 text-sm font-medium">Download payslips</p>
            <ul className="space-y-2">
              {(payslipDocsQuery.data ?? []).map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="font-medium">{d.name}</span>
                  <Button size="sm" variant="outline" onClick={() => downloadPayslip(d.id, d.name)}>
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Payroll entries" className="mt-6">
        {visibleEntries.length === 0 ? (
          <EmptyState title="No entries yet." />
        ) : (
          <ul className="space-y-3">
            {visibleEntries.map((e) => {
              const run = runById.get(e.run_id);
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">
                      {names.get(e.employee_id) ?? "—"}{" "}
                      <span className="text-muted-foreground">
                        · {run?.period_start ?? "—"} → {run?.period_end ?? "—"}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Basic {formatMoney(Number(e.basic ?? 0))} · net{" "}
                      {formatMoney(Number(e.net ?? 0))}
                      {!hr ? (
                        <>
                          {" · allowances "}
                          {formatMoney(Number(e.allowances ?? 0))}
                          {" · deductions "}
                          {formatMoney(Number(e.deductions ?? 0))}
                          {" · gross "}
                          {formatMoney(Number(e.gross ?? 0))}
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={e.status} />
                    {canManage && run?.status === "draft" ? (
                      <form
                        className="flex items-center gap-1.5"
                        onSubmit={(ev) => {
                          ev.preventDefault();
                          saveEntry.mutate({
                            id: e.id,
                            form: Object.fromEntries(new FormData(ev.currentTarget).entries()),
                          });
                        }}
                      >
                        <Input
                          aria-label="Allowances"
                          name="allowances"
                          type="number"
                          step="0.01"
                          defaultValue={Number(e.allowances ?? 0)}
                          className="h-8 w-20"
                        />
                        <Input
                          aria-label="Deductions"
                          name="deductions"
                          type="number"
                          step="0.01"
                          defaultValue={Number(e.deductions ?? 0)}
                          className="h-8 w-20"
                        />
                        <Button size="sm" variant="outline">
                          Save
                        </Button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </>
  );
}
