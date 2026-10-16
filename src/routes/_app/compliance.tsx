import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { daysUntil, fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, hasPermission, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/compliance")({
  head: () => ({
    meta: [
      { title: "Compliance — Spine AI" },
      {
        name: "description",
        content: "Mandatory items and per-employee compliance tracking across your organization.",
      },
      { property: "og:title", content: "Compliance — Spine AI" },
      { property: "og:description", content: "HR compliance tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CompliancePage,
});

function CompliancePage() {
  const { roles, permissions, user, employee } = useAuth();
  const queryClient = useQueryClient();
  const hr = isHr(roles);
  const canManage = hasPermission(roles, permissions, "manage_compliance");
  const [open, setOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [completeFor, setCompleteFor] = useState<string | null>(null);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const itemsQuery = useQuery({
    queryKey: ["compliance-items"],
    queryFn: async () => {
      const { data, error } = await supabase.from("compliance_items").select("*").order("title");
      if (error) throw error;
      return data ?? [];
    },
  });
  const recordsQuery = useQuery({
    queryKey: ["compliance-records"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_compliance")
        .select("*")
        .order("due_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const createItem = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { data, error } = await supabase
        .from("compliance_items")
        .insert({
          title: String(form["title"]),
          category: String(form["category"] ?? "legal"),
          default_due_in_days: Number(form["default_due_in_days"]) || 30,
          recurrence: String(form["recurrence"] ?? "none"),
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "compliance.item_created",
        entity: "compliance_items",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Compliance item created");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["compliance-items"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The item could not be created."),
  });

  const assign = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const itemId = assignFor;
      if (!itemId) throw new Error("No compliance item selected.");
      const { data, error } = await supabase
        .from("employee_compliance")
        .insert({
          item_id: itemId,
          employee_id: String(form["employee_id"]),
          due_date: String(form["due_date"] || "") || null,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "compliance.assigned",
        entity: "employee_compliance",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Compliance task assigned");
      setAssignFor(null);
      void queryClient.invalidateQueries({ queryKey: ["compliance-records"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The assignment could not be saved."),
  });

  const complete = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const id = completeFor;
      if (!id) throw new Error("No compliance record selected.");
      const { error } = await supabase
        .from("employee_compliance")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          notes: String(form["notes"] ?? "") || null,
        })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "compliance.completed",
        entity: "employee_compliance",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Compliance record completed");
      setCompleteFor(null);
      void queryClient.invalidateQueries({ queryKey: ["compliance-records"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The update could not be saved."),
  });

  if (!canAccess("compliance", roles, permissions))
    return <NoPermissionState what="compliance information" />;
  if (itemsQuery.isLoading) return <LoadingState rows={6} />;
  if (itemsQuery.isError) return <ErrorState message="Unable to load compliance data." />;

  const names = nameMap(employeesQuery.data ?? []);
  const items = itemsQuery.data ?? [];
  const records = recordsQuery.data ?? [];
  const mine = employee ? records.filter((r) => r.employee_id === employee.id) : [];
  const visibleRecords = hr ? records : mine;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const openRecords = records.filter((r) => r.status !== "completed").length;
  const overdue = records.filter(
    (r) => r.status !== "completed" && (daysUntil(r.due_date) ?? 1) < 0,
  ).length;
  const completedCount = records.filter((r) => r.status === "completed").length;

  return (
    <>
      <PageHeader
        title="Compliance"
        description="Track mandatory compliance items and who still owes them."
        actions={
          canManage ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Add item
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add compliance item</DialogTitle>
                </DialogHeader>
                <form
                  id="compliance-form"
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    createItem.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      name="title"
                      required
                      placeholder="Annual background verification"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="category">Category</Label>
                    <Input id="category" name="category" defaultValue="legal" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="default_due_in_days">Default due (days)</Label>
                      <Input
                        id="default_due_in_days"
                        name="default_due_in_days"
                        type="number"
                        min={0}
                        defaultValue="30"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Recurrence</Label>
                      <RecurrenceSelect />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description">Description</Label>
                    <Textarea id="description" name="description" rows={3} />
                  </div>
                </form>
                <DialogFooter>
                  <Button type="submit" form="compliance-form" disabled={createItem.isPending}>
                    {createItem.isPending ? "Saving..." : "Add item"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Compliance items"
          value={items.length}
          icon={<BadgeCheck className="h-4 w-4" />}
        />
        <StatCard label="Open records" value={openRecords} />
        <StatCard label="Overdue" value={overdue} tone="destructive" />
        <StatCard label="Completed" value={completedCount} tone="success" />
      </div>

      <SectionCard title="Compliance items" className="mt-6">
        {items.length === 0 ? (
          <EmptyState title="No compliance items yet." />
        ) : (
          <ul className="space-y-3">
            {items.map((i) => {
              const itemRecords = records.filter((r) => r.item_id === i.id);
              const done = itemRecords.filter((r) => r.status === "completed").length;
              return (
                <li key={i.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <p className="font-medium">{i.title}</p>
                        <StatusBadge status={i.status} />
                      </div>
                      <p className="mt-1 text-xs capitalize text-muted-foreground">
                        {i.category.replace("_", " ")} · due in {i.default_due_in_days}d ·{" "}
                        {i.recurrence.replace("_", " ")}
                      </p>
                      {i.description ? (
                        <p className="mt-2 text-sm text-muted-foreground">{i.description}</p>
                      ) : null}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {done} of {itemRecords.length} completed
                      </p>
                    </div>
                    {canManage ? (
                      <Button size="sm" onClick={() => setAssignFor(i.id)}>
                        Assign
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={hr ? "Employee records" : "My compliance"} className="mt-6">
        {visibleRecords.length === 0 ? (
          <EmptyState title="No records yet." />
        ) : (
          <ul className="space-y-3">
            {visibleRecords.map((r) => (
              <li key={r.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="font-medium">
                        {itemById.get(r.item_id)?.title ?? "Item"}{" "}
                        <span className="text-muted-foreground">
                          · {names.get(r.employee_id) ?? "—"}
                        </span>
                      </p>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Due {r.due_date ?? "—"}
                      {r.completed_at
                        ? ` · completed ${new Date(r.completed_at).toLocaleDateString()}`
                        : ""}
                    </p>
                    {r.notes ? (
                      <p className="mt-1 text-sm text-muted-foreground">{r.notes}</p>
                    ) : null}
                  </div>
                  {canManage && r.status !== "completed" ? (
                    <Button size="sm" variant="outline" onClick={() => setCompleteFor(r.id)}>
                      Mark done
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Dialog
        open={assignFor !== null}
        onOpenChange={(o) => {
          if (!o) setAssignFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign compliance item</DialogTitle>
          </DialogHeader>
          <form
            id="assign-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              assign.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
            }}
          >
            <input type="hidden" name="item_id" value={assignFor ?? ""} />
            <p className="text-sm text-muted-foreground">
              Item: {assignFor ? (itemById.get(assignFor)?.title ?? "—") : "—"}
            </p>
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
            <div className="space-y-1.5">
              <Label htmlFor="due_date">Due date</Label>
              <Input id="due_date" name="due_date" type="date" />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="assign-form" disabled={assign.isPending}>
              {assign.isPending ? "Assigning..." : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={completeFor !== null}
        onOpenChange={(o) => {
          if (!o) setCompleteFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete compliance record</DialogTitle>
          </DialogHeader>
          <form
            id="complete-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              complete.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={3} />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="complete-form" disabled={complete.isPending}>
              {complete.isPending ? "Saving..." : "Mark done"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecurrenceSelect() {
  const [value, setValue] = useState("none");
  return (
    <>
      <input type="hidden" name="recurrence" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          <SelectItem value="yearly">Yearly</SelectItem>
          <SelectItem value="quarterly">Quarterly</SelectItem>
          <SelectItem value="on_training">On training</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
