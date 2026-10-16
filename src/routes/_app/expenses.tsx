import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, ReceiptText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, hasPermission } from "@/lib/rbac";

export const Route = createFileRoute("/_app/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses — Spine AI" },
      {
        name: "description",
        content: "Submit and approve expense requests across your authorized scope.",
      },
      { property: "og:title", content: "Expenses — Spine AI" },
      { property: "og:description", content: "Expense submissions and approvals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExpensesPage,
});

const CATEGORIES = [
  "travel",
  "fuel",
  "meals",
  "lodging",
  "equipment",
  "training",
  "medical",
  "other",
];

function ExpensesPage() {
  const { roles, permissions, employee, user } = useAuth();
  const queryClient = useQueryClient();
  const canDecide = hasPermission(roles, permissions, "manage_employee");
  const canManagePolicy = canDecide || hasPermission(roles, permissions, "manage_payroll");
  const [open, setOpen] = useState(false);
  const [decideFor, setDecideFor] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const expensesQuery = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_requests")
        .select("*")
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const policiesQuery = useQuery({
    queryKey: ["expense-policies"],
    queryFn: async () => {
      const { data, error } = await supabase.from("expense_policies").select("*").order("category");
      if (error) throw error;
      return data ?? [];
    },
  });

  const submit = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      if (!employee) throw new Error("No employee profile linked to your account.");
      const { data, error } = await supabase
        .from("expense_requests")
        .insert({
          employee_id: employee.id,
          category: String(form["category"]),
          amount: Number(form["amount"]) || 0,
          currency: String(form["currency"]),
          expense_date: String(form["expense_date"]),
          description: String(form["description"] ?? ""),
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "expense.submitted",
        entity: "expense_requests",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Expense request submitted");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Expense could not be submitted."),
  });

  const decide = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const id = decideFor;
      if (!id) throw new Error("No expense selected.");
      const status = String(form["status"]);
      const { error } = await supabase
        .from("expense_requests")
        .update({
          status,
          approver_id: employee?.id ?? null,
          decided_at: new Date().toISOString(),
          decision_note: String(form["note"] ?? "") || null,
        })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: `expense.${status}`,
        entity: "expense_requests",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Expense decision saved");
      setDecideFor(null);
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: () => toast.error("You do not have permission to decide on this expense."),
  });

  const reimburse = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("expense_requests")
        .update({
          status: "reimbursed",
          reimbursed_at: new Date().toISOString(),
          reimbursed_by: user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "expense.reimbursed",
        entity: "expense_requests",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Expense marked as reimbursed");
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The reimbursement could not be recorded."),
  });

  const savePolicy = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      setPolicyBusy(true);
      const entry = {
        category: String(form["category"]),
        currency: String(form["currency"] ?? "USD") || "USD",
        max_amount: Number(form["max_amount"]) || null,
        requires_receipt: form["requires_receipt"] === "on",
        notes: String(form["notes"] ?? "") || null,
      };
      const existing = policiesQuery.data?.find((p) => p.category === entry.category);
      let id = existing?.id ?? null;
      if (id) {
        const { error } = await supabase.from("expense_policies").update(entry).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("expense_policies")
          .insert(entry)
          .select("id")
          .single();
        if (error) throw error;
        id = data.id;
      }
      await logAudit({
        userId: user?.id,
        action: id
          ? `expense_policy.${existing ? "updated" : "created"}`
          : "expense_policy.created",
        entity: "expense_policies",
        entityId: existing?.id ?? id,
      });
    },
    onSuccess: () => {
      toast.success("Expense policy saved");
      setPolicyOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["expense-policies"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The policy could not be saved."),
  });

  if (!canAccess("expenses", roles, permissions))
    return <NoPermissionState what="expense information" />;
  if (expensesQuery.isLoading) return <LoadingState rows={6} />;
  if (expensesQuery.isError) return <ErrorState message="Unable to load expenses." />;

  const names = nameMap(employeesQuery.data ?? []);
  const expenses = expensesQuery.data ?? [];
  const pending = expenses.filter((e) => e.status === "pending");
  const pendingAmount = pending.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const approved = expenses.filter((e) => e.status === "approved");
  const approvedAmount = approved.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const mine = employee ? expenses.filter((e) => e.employee_id === employee.id) : [];

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Submit expenses and review requests across your authorized scope."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Submit expense
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Submit expense</DialogTitle>
              </DialogHeader>
              <form
                id="expense-form"
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  submit.mutate(Object.fromEntries(fd.entries()));
                }}
              >
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <CategorySelect />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="amount">Amount</Label>
                    <Input id="amount" name="amount" type="number" min={0} step="0.01" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="currency">Currency</Label>
                    <Input id="currency" name="currency" defaultValue="USD" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense_date">Expense date</Label>
                  <Input id="expense_date" name="expense_date" type="date" required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" name="description" rows={3} required />
                </div>
              </form>
              <DialogFooter>
                <Button type="submit" form="expense-form" disabled={submit.isPending}>
                  {submit.isPending ? "Submitting..." : "Submit"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pending requests" value={pending.length} />
        <StatCard
          label="Pending amount"
          value={formatMoney(pendingAmount)}
          tone="warning"
          icon={<ReceiptText className="h-4 w-4" />}
        />
        <StatCard label="Approved" value={approved.length} tone="success" />
        <StatCard label="Approved amount" value={formatMoney(approvedAmount)} tone="success" />
      </div>

      {mine.length ? (
        <SectionCard title="My expenses" className="mt-6">
          <ExpenseTable
            expenses={mine}
            names={names}
            canDecide={false}
            onDecide={() => undefined}
            onReimburse={() => undefined}
          />
        </SectionCard>
      ) : null}

      <SectionCard title="Expense requests" className="mt-6">
        {expenses.length === 0 ? (
          <EmptyState title="No expense requests yet." />
        ) : (
          <ExpenseTable
            expenses={expenses}
            names={names}
            canDecide={canDecide}
            onDecide={(id) => setDecideFor(id)}
            onReimburse={(id) => reimburse.mutate(id)}
          />
        )}
      </SectionCard>

      <SectionCard
        title="Expense policies"
        className="mt-6"
        actions={
          canManagePolicy ? (
            <Button size="sm" variant="outline" onClick={() => setPolicyOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />{" "}
              {policiesQuery.data?.length ? "Edit policy" : "Add policy"}
            </Button>
          ) : undefined
        }
      >
        {policiesQuery.isLoading ? (
          <LoadingState rows={2} />
        ) : policiesQuery.data?.length === 0 ? (
          <EmptyState
            title="No expense policies yet."
            description="HR can add category limits and receipt rules."
          />
        ) : (
          <ul className="space-y-2">
            {(policiesQuery.data ?? []).map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium capitalize">{p.category.replace("_", " ")}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.max_amount != null
                      ? `max ${formatMoney(Number(p.max_amount), p.currency ?? "USD")}`
                      : "no limit"}
                    {" · "}
                    {p.requires_receipt ? "receipt required" : "receipt not required"}
                  </p>
                </div>
                {p.notes ? (
                  <p className="max-w-sm truncate text-xs text-muted-foreground">{p.notes}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Dialog open={policyOpen} onOpenChange={setPolicyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Expense policy</DialogTitle>
          </DialogHeader>
          <form
            id="policy-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              savePolicy.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                name="category"
                list="policy-categories"
                required
                placeholder="travel"
              />
              <datalist id="policy-categories">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="max_amount">Max amount</Label>
                <Input id="max_amount" name="max_amount" type="number" min={0} step="0.01" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" name="currency" defaultValue="USD" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="requires_receipt" name="requires_receipt" defaultChecked />
              <Label htmlFor="requires_receipt">Receipt required</Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="policy-form" disabled={savePolicy.isPending || policyBusy}>
              {savePolicy.isPending ? "Saving..." : "Save policy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={decideFor !== null}
        onOpenChange={(o) => {
          if (!o) setDecideFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decide on expense</DialogTitle>
          </DialogHeader>
          <form
            id="decide-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              decide.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
            }}
          >
            <div className="space-y-1.5">
              <Label>Decision</Label>
              <DecisionSelect />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">Note</Label>
              <Textarea id="note" name="note" rows={3} />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="decide-form" disabled={decide.isPending}>
              Save decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExpenseTable({
  expenses,
  names,
  canDecide,
  onDecide,
  onReimburse,
}: {
  expenses: {
    status: string;
    category: string;
    amount: number | null;
    currency: string | null;
    expense_date: string;
    description: string | null;
    employee_id: string;
    id: string;
  }[];
  names: Map<string, string>;
  canDecide: boolean;
  onDecide: (id: string) => void;
  onReimburse: (id: string) => void;
}) {
  return (
    <ul className="space-y-3">
      {expenses.map((e) => (
        <li
          key={e.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <p className="font-medium">
                {formatMoney(Number(e.amount ?? 0), e.currency ?? undefined)}{" "}
                <span className="text-muted-foreground">· {e.category}</span>
              </p>
              <StatusBadge status={e.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {names.get(e.employee_id ?? "") ?? "—"} · {e.expense_date}
            </p>
            {e.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
            ) : null}
          </div>
          {canDecide && e.status === "pending" ? (
            <Button size="sm" variant="outline" onClick={() => onDecide(e.id)}>
              Decide
            </Button>
          ) : null}
          {canDecide && e.status === "approved" ? (
            <Button size="sm" variant="outline" onClick={() => onReimburse(e.id)}>
              Reimburse
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CategorySelect() {
  const [value, setValue] = useState(CATEGORIES[0]!);
  return (
    <>
      <input type="hidden" name="category" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function DecisionSelect() {
  const [value, setValue] = useState("approved");
  return (
    <>
      <input type="hidden" name="status" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="approved">Approve</SelectItem>
          <SelectItem value="rejected">Reject</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

function formatMoney(amount: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
