import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
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
import { Progress } from "@/components/ui/progress";
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
import { canAccess, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/offboarding")({
  head: () => ({
    meta: [
      { title: "Offboarding — Spine AI" },
      {
        name: "description",
        content:
          "Exit journeys, the exit checklist and final settlement across your authorized scope.",
      },
      { property: "og:title", content: "Offboarding — Spine AI" },
      { property: "og:description", content: "Exit journeys and checklist tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OffboardingPage,
});

const DEFAULT_TEMPLATE = [
  { category: "hr", title: "Conduct exit interview", owner: "hr" },
  { category: "it", title: "Revoke system and email access", owner: "it" },
  { category: "finance", title: "Process final salary and settlement", owner: "finance" },
  { category: "assets", title: "Return company assets and keys", owner: "admin" },
  { category: "hr", title: "Issue relieving letter", owner: "hr" },
  { category: "admin", title: "Revoke ID card and office access", owner: "admin" },
] as const;

function OffboardingPage() {
  const { roles, permissions, user } = useAuth();
  const queryClient = useQueryClient();
  const hr = isHr(roles);
  const [open, setOpen] = useState(false);
  const [completeFor, setCompleteFor] = useState<string | null>(null);
  const [addItemFor, setAddItemFor] = useState<string | null>(null);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const offboardingsQuery = useQuery({
    queryKey: ["offboardings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("offboardings")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const checklistQuery = useQuery({
    queryKey: ["exit-checklist"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exit_checklist_items")
        .select("*")
        .order("due_date");
      if (error) throw error;
      return data ?? [];
    },
  });

  const initiate = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { data, error } = await supabase
        .from("offboardings")
        .insert({
          employee_id: String(form["employee_id"]),
          exit_type: String(form["exit_type"]),
          reason: String(form["reason"] ?? "") || null,
          notice_start_date: String(form["notice_start_date"]),
          last_working_day: String(form["last_working_day"] || "") || null,
          status: "initiated",
          initiated_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      await supabase.from("exit_checklist_items").insert(
        DEFAULT_TEMPLATE.map((t) => ({
          offboarding_id: data.id,
          category: t.category,
          title: t.title,
          owner: t.owner,
          status: "pending",
        })),
      );
      await logAudit({
        userId: user?.id,
        action: "offboarding.initiated",
        entity: "offboardings",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Exit journey started with a standard checklist");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["offboardings"] });
      void queryClient.invalidateQueries({ queryKey: ["exit-checklist"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The exit journey could not be started."),
  });

  const advance = useMutation({
    mutationFn: async ({ id, to }: { id: string; to: string }) => {
      const { error } = await supabase.from("offboardings").update({ status: to }).eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: `offboarding.${to}`,
        entity: "offboardings",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Offboarding updated");
      void queryClient.invalidateQueries({ queryKey: ["offboardings"] });
    },
    onError: () => toast.error("Only HR can update offboarding status."),
  });

  const completeExit = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const id = completeFor;
      if (!id) throw new Error("No offboarding selected.");
      const { error } = await supabase
        .from("offboardings")
        .update({
          status: "completed",
          exit_interview_notes: String(form["notes"] ?? "") || null,
          final_settlement_note: String(form["settlement"] ?? "") || null,
          completed_by: user?.id ?? null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "offboarding.completed",
        entity: "offboardings",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Exit journey completed");
      setCompleteFor(null);
      void queryClient.invalidateQueries({ queryKey: ["offboardings"] });
    },
    onError: () => toast.error("The exit could not be completed."),
  });

  const toggleItem = useMutation({
    mutationFn: async (id: string) => {
      const item = items.find((i) => i.id === id);
      if (!item) throw new Error("Checklist item not found.");
      const next = item.status === "completed" ? "pending" : "completed";
      const { error } = await supabase
        .from("exit_checklist_items")
        .update({
          status: next,
          completed_at: next === "completed" ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["exit-checklist"] }),
    onError: () => toast.error("You do not have permission to update this item."),
  });

  const addItem = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const id = addItemFor;
      if (!id) throw new Error("No offboarding selected.");
      const { error } = await supabase.from("exit_checklist_items").insert({
        offboarding_id: id,
        category: String(form["category"] ?? "hr"),
        title: String(form["title"]),
        owner: String(form["owner"] ?? "hr") || "hr",
        due_date: String(form["due_date"] || "") || null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Checklist item added");
      setAddItemFor(null);
      void queryClient.invalidateQueries({ queryKey: ["exit-checklist"] });
    },
    onError: () => toast.error("The item could not be added."),
  });

  if (!canAccess("offboarding", roles, permissions))
    return <NoPermissionState what="offboarding information" />;
  if (offboardingsQuery.isLoading) return <LoadingState rows={5} />;
  if (offboardingsQuery.isError) return <ErrorState message="Unable to load offboarding data." />;

  const names = nameMap(employeesQuery.data ?? []);
  const offboardings = offboardingsQuery.data ?? [];
  const items = checklistQuery.data ?? [];
  const byOffboarding = new Map<string, typeof items>();
  items.forEach((i) => {
    const key = i.offboarding_id;
    const list = byOffboarding.get(key) ?? [];
    list.push(i);
    byOffboarding.set(key, list);
  });
  const inProgress = offboardings.filter((o) => o.status !== "completed").length;
  const completed = offboardings.filter((o) => o.status === "completed").length;
  const pendingItems = items.filter((i) => i.status !== "completed").length;
  const overdueItems = items.filter(
    (i) => i.status !== "completed" && (daysUntil(i.due_date) ?? 1) < 0,
  ).length;
  const activeIds = new Set(
    offboardings.filter((o) => o.status !== "completed").map((o) => o.employee_id),
  );
  const pickable = (employeesQuery.data ?? []).filter((e) => !activeIds.has(e.id));

  return (
    <>
      <PageHeader
        title="Offboarding"
        description="Exit journeys, checklists and final settlement for departing teammates."
        actions={
          hr ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Initiate exit
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Initiate offboarding</DialogTitle>
                </DialogHeader>
                <form
                  id="offboarding-form"
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    initiate.mutate(Object.fromEntries(fd.entries()));
                  }}
                >
                  <EmployeePicker
                    employees={pickable.map((e) => ({
                      id: e.id,
                      name: `${e.first_name} ${e.last_name}`,
                    }))}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="exit_type">Exit type</Label>
                    <ExitTypeSelect />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="reason">Reason</Label>
                    <Textarea id="reason" name="reason" rows={2} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="notice_start_date">Notice started</Label>
                      <Input id="notice_start_date" name="notice_start_date" type="date" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="last_working_day">Last working day</Label>
                      <Input id="last_working_day" name="last_working_day" type="date" />
                    </div>
                  </div>
                </form>
                <DialogFooter>
                  <Button type="submit" form="offboarding-form" disabled={initiate.isPending}>
                    {initiate.isPending ? "Starting..." : "Start exit"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Exits in progress" value={inProgress} />
        <StatCard label="Completed exits" value={completed} tone="success" />
        <StatCard label="Checklist open" value={pendingItems} />
        <StatCard label="Checklist overdue" value={overdueItems} tone="destructive" />
      </div>

      {offboardings.length === 0 ? (
        <EmptyState title="No exit journeys yet." />
      ) : (
        <div className="mt-6 space-y-4">
          {offboardings.map((o) => {
            const list = byOffboarding.get(o.id) ?? [];
            const done = list.filter((i) => i.status === "completed").length;
            const pct = list.length ? Math.round((done / list.length) * 100) : 0;
            return (
              <SectionCard
                key={o.id}
                title={names.get(o.employee_id) ?? "Employee"}
                actions={<StatusBadge status={o.status} />}
                description={`${o.exit_type.replace("_", " ")} · last working day ${o.last_working_day ?? "—"}`}
              >
                {o.reason ? <p className="mb-3 text-sm text-muted-foreground">{o.reason}</p> : null}
                <div className="mb-4 flex items-center gap-3">
                  <Progress value={pct} className="h-2" />
                  <span className="w-24 text-right text-xs text-muted-foreground">
                    {done} of {list.length} done
                  </span>
                </div>
                {list.length === 0 ? (
                  <EmptyState title="No checklist items yet." />
                ) : (
                  <ul className="space-y-2">
                    {list.map((i) => (
                      <li
                        key={i.id}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">{i.title}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {i.category} · {i.owner} {i.due_date ? ` · due ${i.due_date}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={i.status} />
                          {hr ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toggleItem.mutate(i.id)}
                            >
                              {i.status === "completed" ? "Reopen" : "Done"}
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  {hr ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setAddItemFor(o.id)}>
                        <Plus className="mr-1.5 h-4 w-4" /> Add item
                      </Button>
                      {o.status === "initiated" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => advance.mutate({ id: o.id, to: "in_progress" })}
                        >
                          Start process
                        </Button>
                      ) : null}
                      {o.status !== "completed" ? (
                        <Button size="sm" onClick={() => setCompleteFor(o.id)}>
                          Complete exit
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  {o.completed_at ? (
                    <p className="ml-auto text-xs text-muted-foreground">
                      Completed {new Date(o.completed_at).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
              </SectionCard>
            );
          })}
        </div>
      )}

      <Dialog
        open={completeFor !== null}
        onOpenChange={(o) => {
          if (!o) setCompleteFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Complete exit</DialogTitle>
          </DialogHeader>
          <form
            id="complete-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              completeExit.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="notes">Exit interview notes</Label>
              <Textarea id="notes" name="notes" rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settlement">Final settlement note</Label>
              <Textarea id="settlement" name="settlement" rows={3} />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="complete-form" disabled={completeExit.isPending}>
              {completeExit.isPending ? "Saving..." : "Mark completed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addItemFor !== null}
        onOpenChange={(o) => {
          if (!o) setAddItemFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add checklist item</DialogTitle>
          </DialogHeader>
          <form
            id="item-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              addItem.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="title">Item</Label>
              <Input id="title" name="title" required placeholder="Return laptop and charger" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="category">Category</Label>
                <Input id="category" name="category" defaultValue="hr" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="owner">Owner</Label>
                <Input id="owner" name="owner" defaultValue="hr" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="due_date">Due date</Label>
              <Input id="due_date" name="due_date" type="date" />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="item-form" disabled={addItem.isPending}>
              Add item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ExitTypeSelect() {
  const [value, setValue] = useState("resignation");
  return (
    <>
      <input type="hidden" name="exit_type" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {["resignation", "retirement", "contract_end", "termination", "redundancy", "mutual"].map(
            (t) => (
              <SelectItem key={t} value={t}>
                {t.replace("_", " ")}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
    </>
  );
}

function EmployeePicker({ employees }: { employees: { id: string; name: string }[] }) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-1.5">
      <Label>Employee</Label>
      <input type="hidden" name="employee_id" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder="Select employee" />
        </SelectTrigger>
        <SelectContent>
          {employees.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
