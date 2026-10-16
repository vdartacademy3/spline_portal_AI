import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Plus } from "lucide-react";
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
import { fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, hasPermission, isHr, isManager } from "@/lib/rbac";

export const Route = createFileRoute("/_app/leave")({
  head: () => ({
    meta: [
      { title: "Leave Management — Spine AI" },
      {
        name: "description",
        content: "Apply for leave, track balances, policies and holiday-aware approvals.",
      },
      { property: "og:title", content: "Leave Management — Spine AI" },
      { property: "og:description", content: "Leave balances, requests and approvals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LeavePage,
});

function LeavePage() {
  const { roles, permissions, employee, user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [policyFor, setPolicyFor] = useState<string | null>(null);
  const approver = isManager(roles);
  const hr = isHr(roles);
  const canManagePolicies = hasPermission(roles, permissions, "manage_leave");

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const typesQuery = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_types")
        .select("id, name, code, annual_quota");
      if (error) throw error;
      return data ?? [];
    },
  });
  const policiesQuery = useQuery({
    queryKey: ["leave-policies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leave_policies").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });
  const holidaysQuery = useQuery({
    queryKey: ["company-holidays"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_holidays")
        .select("id, date, name, optional")
        .order("date")
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
  });

  const requestsQuery = useQuery({
    queryKey: ["leave-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_requests")
        .select(
          "id, employee_id, leave_type_id, start_date, end_date, days, is_half_day, half_day_part, reason, status, decision_note",
        )
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const balancesQuery = useQuery({
    queryKey: ["leave-balances", employee?.id],
    enabled: Boolean(employee?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_balances")
        .select("id, leave_type_id, entitled, used")
        .eq("employee_id", employee!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const apply = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      if (!employee) throw new Error("no employee record");
      const halfDay = String(form["is_half_day"] ?? "") === "on";
      const insert: Record<string, unknown> = {
        employee_id: employee.id,
        leave_type_id: String(form["leave_type_id"]),
        start_date: String(form["start_date"]),
        end_date: halfDay ? String(form["start_date"]) : String(form["end_date"]),
        reason: String(form["reason"] ?? ""),
        is_half_day: halfDay,
        half_day_part: halfDay ? String(form["half_day_part"] ?? "first_half") : null,
      };
      const { error } = await supabase.from("leave_requests").insert(insert as never);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "leave.requested",
        entity: "leave_requests",
        next: insert,
      });
    },
    onSuccess: () => {
      toast.success("Leave request submitted");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Your leave request could not be submitted."),
  });

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "rejected" }) => {
      const { error } = await supabase
        .from("leave_requests")
        .update({ status, approver_id: employee?.id ?? null, decided_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: `leave.${status}`,
        entity: "leave_requests",
        entityId: id,
      });
    },
    onSuccess: (_d, v) => {
      toast.success(`Request ${v.status}`);
      void queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    },
    onError: () => toast.error("You do not have permission to decide on this request."),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("leave_requests")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "leave.cancelled",
        entity: "leave_requests",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Request cancelled");
      void queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
    },
    onError: () => toast.error("Only pending requests you submitted can be cancelled."),
  });

  const savePolicy = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { error } = await supabase.from("leave_policies").upsert(
        {
          leave_type_id: String(form["leave_type_id"]),
          max_consecutive_days: Number(form["max_consecutive_days"]) || null,
          carry_forward_max: Number(form["carry_forward_max"]) || 0,
          accrual_period: String(form["accrual_period"] || "annual"),
          min_notice_days: Number(form["min_notice_days"]) || 0,
          requires_approval: String(form["requires_approval"] ?? "") === "on",
          allow_half_day: String(form["allow_half_day"] ?? "") === "on",
          allow_negative_balance: String(form["allow_negative_balance"] ?? "") === "on",
        },
        { onConflict: "leave_type_id" },
      );
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "leave.policy_saved",
        entity: "leave_policies",
        next: form,
      });
    },
    onSuccess: () => {
      toast.success("Leave policy updated");
      setPolicyFor(null);
      void queryClient.invalidateQueries({ queryKey: ["leave-policies"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The policy could not be saved."),
  });

  if (!canAccess("leave", roles, permissions))
    return <NoPermissionState what="leave information" />;
  if (requestsQuery.isLoading) return <LoadingState rows={6} />;
  if (requestsQuery.isError) return <ErrorState message="Unable to load leave data." />;

  const names = nameMap(employeesQuery.data ?? []);
  const typeNames = new Map((typesQuery.data ?? []).map((t) => [t.id, t.name]));
  const requests = requestsQuery.data ?? [];
  const pending = requests.filter((r) => r.status === "pending");
  const today = new Date().toISOString().slice(0, 10);
  const onLeaveToday = requests.filter(
    (r) => r.status === "approved" && r.start_date <= today && r.end_date >= today,
  );
  const policies = policiesQuery.data ?? [];
  const holidays = holidaysQuery.data ?? [];
  const upcomingHolidays = holidays.filter((h) => h.date >= today);
  const policiesFor = policyFor ? (typesQuery.data ?? []).find((t) => t.id === policyFor) : null;
  const existing = policies.find((p) => p.leave_type_id === policyFor);

  return (
    <>
      <PageHeader
        title="Leave"
        description="Balances, requests, policies and holiday-aware approvals scoped to your access."
        actions={
          employee ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Apply for leave
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Apply for leave</DialogTitle>
                </DialogHeader>
                <form
                  id="leave-form"
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    apply.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
                  }}
                >
                  <div className="space-y-1.5">
                    <Label>Leave type</Label>
                    <LeaveTypeSelect options={typesQuery.data ?? []} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="start_date">From</Label>
                      <Input id="start_date" name="start_date" type="date" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="end_date">To</Label>
                      <Input id="end_date" name="end_date" type="date" required />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="is_half_day" />
                    Half day (0.5) — single day only
                  </label>
                  <div className="space-y-1.5">
                    <Label htmlFor="half_day_part">Half</Label>
                    <AddHalfPartSelect />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reason">Reason</Label>
                    <Textarea id="reason" name="reason" rows={3} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Weekends and company holidays are excluded from the day count.
                  </p>
                </form>
                <DialogFooter>
                  <Button type="submit" form="leave-form" disabled={apply.isPending}>
                    {apply.isPending ? "Submitting..." : "Submit request"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pending approvals" value={pending.length} tone="warning" />
        <StatCard label="On leave today" value={onLeaveToday.length} />
        {(balancesQuery.data ?? []).map((b) => (
          <StatCard
            key={b.id}
            label={`${typeNames.get(b.leave_type_id) ?? "Leave"} balance`}
            value={Number(b.entitled) - Number(b.used)}
            hint={`${b.used} used of ${b.entitled}`}
          />
        ))}
        {!employee || (balancesQuery.data ?? []).length === 0 ? (
          <StatCard
            label="Upcoming holidays"
            value={upcomingHolidays.length}
            icon={<CalendarDays className="h-4 w-4" />}
          />
        ) : null}
      </div>

      {approver ? (
        <SectionCard title="Pending approvals" className="mt-6">
          {pending.length === 0 ? (
            <EmptyState title="No pending requests." description="Everything is up to date." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{names.get(r.employee_id) ?? "—"}</TableCell>
                    <TableCell>{typeNames.get(r.leave_type_id) ?? "—"}</TableCell>
                    <TableCell>
                      {r.start_date} → {r.end_date}
                    </TableCell>
                    <TableCell>{r.days}</TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        size="sm"
                        onClick={() => decide.mutate({ id: r.id, status: "approved" })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decide.mutate({ id: r.id, status: "rejected" })}
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

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <SectionCard title="All leave requests" className="lg:col-span-2">
          {requests.length === 0 ? (
            <EmptyState title="No leave requests." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {names.get(r.employee_id) ?? "—"}
                      </TableCell>
                      <TableCell>
                        {typeNames.get(r.leave_type_id) ?? "—"}
                        {r.is_half_day ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({r.half_day_part?.replace("_", " ")})
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {r.start_date} → {r.end_date}
                      </TableCell>
                      <TableCell>{r.days}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <StatusBadge status={r.status} />
                          {r.employee_id === employee?.id && r.status === "pending" ? (
                            <Button size="sm" variant="ghost" onClick={() => cancel.mutate(r.id)}>
                              Cancel
                            </Button>
                          ) : null}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard
            title="Upcoming holidays"
            description="Company holidays excluded from leave day counts"
          >
            {upcomingHolidays.length === 0 ? (
              <EmptyState title="No upcoming holidays on file." />
            ) : (
              <ul className="space-y-2">
                {upcomingHolidays.map((h) => (
                  <li
                    key={h.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{h.name}</p>
                      <p className="text-xs text-muted-foreground">{h.date}</p>
                    </div>
                    {h.optional ? (
                      <StatusBadge status="optional" />
                    ) : (
                      <StatusBadge status="holiday" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Leave policies" description="Rules enforced by the leave engine">
            {(typesQuery.data ?? []).map((t) => {
              const p = policies.find((pol) => pol.leave_type_id === t.id);
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
                >
                  <div>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p
                        ? `${p.allow_half_day ? "half-day · " : ""}${p.allow_negative_balance ? "negative allowed · " : ""}max ${p.max_consecutive_days || "unlimited"} days · ${p.min_notice_days || 0}d notice`
                        : "No policy configured — defaults apply"}
                    </p>
                  </div>
                  {canManagePolicies ? (
                    <Button size="sm" variant="outline" onClick={() => setPolicyFor(t.id)}>
                      {p ? "Edit" : "Configure"}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </SectionCard>
        </div>
      </div>

      <Dialog
        open={policyFor !== null}
        onOpenChange={(o) => {
          if (!o) setPolicyFor(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{policiesFor?.name ?? "Leave policy"}</DialogTitle>
          </DialogHeader>
          <form
            id="policy-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              savePolicy.mutate(Object.fromEntries(fd.entries()));
            }}
          >
            <input type="hidden" name="leave_type_id" value={policyFor ?? ""} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="max_consecutive_days">Max consecutive days (0 = unlimited)</Label>
                <Input
                  id="max_consecutive_days"
                  name="max_consecutive_days"
                  type="number"
                  min={0}
                  defaultValue={existing?.max_consecutive_days ?? 0}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="carry_forward_max">Carry-forward max</Label>
                <Input
                  id="carry_forward_max"
                  name="carry_forward_max"
                  type="number"
                  min={0}
                  step="0.5"
                  defaultValue={existing?.carry_forward_max ?? 0}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="min_notice_days">Minimum notice (days)</Label>
                <Input
                  id="min_notice_days"
                  name="min_notice_days"
                  type="number"
                  min={0}
                  defaultValue={existing?.min_notice_days ?? 0}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="accrual_period">Accrual period</Label>
                <Input
                  id="accrual_period"
                  name="accrual_period"
                  defaultValue={existing?.accrual_period ?? "annual"}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="requires_approval"
                defaultChecked={existing ? existing.requires_approval : true}
              />
              Requires approval
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="allow_half_day"
                defaultChecked={Boolean(existing?.allow_half_day)}
              />
              Allow half-day leave
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="allow_negative_balance"
                defaultChecked={Boolean(existing?.allow_negative_balance)}
              />
              Allow negative balance
            </label>
          </form>
          <DialogFooter>
            <Button type="submit" form="policy-form" disabled={savePolicy.isPending}>
              Save policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AddHalfPartSelect() {
  return (
    <Select name="half_day_part" defaultValue="first_half">
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="first_half">First half</SelectItem>
        <SelectItem value="second_half">Second half</SelectItem>
      </SelectContent>
    </Select>
  );
}

function LeaveTypeSelect({ options }: { options: { id: string; name: string }[] }) {
  const [value, setValue] = useState("");
  return (
    <>
      <input type="hidden" name="leave_type_id" value={value} required />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder="Select leave type" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
