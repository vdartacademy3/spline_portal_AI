import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
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
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { daysUntil, fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, isHr, isManager } from "@/lib/rbac";

export const Route = createFileRoute("/_app/onboarding")({
  head: () => ({
    meta: [
      { title: "Onboarding — Spine AI" },
      {
        name: "description",
        content: "Track new-hire onboarding journeys, task completion and overdue steps.",
      },
      { property: "og:title", content: "Onboarding — Spine AI" },
      { property: "og:description", content: "New hire journeys and task progress." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { roles, permissions, user, employee } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [applyFor, setApplyFor] = useState<string | null>(null);
  const [taskForTemplate, setTaskForTemplate] = useState<string | null>(null);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const tasksQuery = useQuery({
    queryKey: ["onboarding-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_tasks")
        .select("id, employee_id, title, owner, due_date, status")
        .order("due_date");
      if (error) throw error;
      return data ?? [];
    },
  });
  const templatesQuery = useQuery({
    queryKey: ["onboarding-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const templateTasksQuery = useQuery({
    queryKey: ["onboarding-template-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("onboarding_template_tasks")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("onboarding_tasks")
        .update({ status: "completed" })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "onboarding.task_completed",
        entity: "onboarding_tasks",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Task marked complete");
      void queryClient.invalidateQueries({ queryKey: ["onboarding-tasks"] });
    },
    onError: () => toast.error("You do not have permission to update this task."),
  });

  const createTask = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const { data, error } = await supabase
        .from("onboarding_tasks")
        .insert({
          employee_id: form["employee_id"] || null,
          title: form["title"]!,
          owner: form["owner"] || "hr",
          due_date: form["due_date"] || null,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "onboarding.task_created",
        entity: "onboarding_tasks",
        entityId: data.id,
        next: form,
      });
    },
    onSuccess: () => {
      toast.success("Onboarding task assigned");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["onboarding-tasks"] });
    },
    onError: () => toast.error("The task could not be created."),
  });

  const createTemplate = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const lines = (form["tasks"] ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const { data, error } = await supabase
        .from("onboarding_templates")
        .insert({
          name: form["name"]!,
          description: form["description"] || null,
          is_default: false,
        })
        .select("id")
        .single();
      if (error) throw error;
      if (lines.length) {
        const { error: tasksError } = await supabase.from("onboarding_template_tasks").insert(
          lines.map((title, i) => ({
            template_id: data.id,
            title,
            owner: "hr",
            due_in_days: i,
            sort_order: i,
          })),
        );
        if (tasksError) throw tasksError;
      }
      await logAudit({
        userId: user?.id,
        action: "onboarding.template_created",
        entity: "onboarding_templates",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Onboarding template saved");
      setTemplateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["onboarding-templates"] });
      void queryClient.invalidateQueries({ queryKey: ["onboarding-template-tasks"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The template could not be created."),
  });

  const addTemplateTask = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const templateId = taskForTemplate;
      if (!templateId) throw new Error("No template selected.");
      const existing = templateTasksQuery.data ?? [];
      const maxSort = existing
        .filter((t) => t.template_id === templateId)
        .reduce((m, t) => Math.max(m, t.sort_order), -1);
      const { error } = await supabase.from("onboarding_template_tasks").insert({
        template_id: templateId,
        title: form["title"]!,
        owner: form["owner"] || "hr",
        due_in_days: Number(form["due_in_days"]) || 0,
        sort_order: maxSort + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Template task added");
      setTaskForTemplate(null);
      void queryClient.invalidateQueries({ queryKey: ["onboarding-template-tasks"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The task could not be added."),
  });

  const applyTemplate = useMutation({
    mutationFn: async (form: Record<string, string>) => {
      const templateId = applyFor;
      const employeeId = form["employee_id"];
      const joining = form["joining_date"];
      if (!templateId || !employeeId) throw new Error("Select a template and a new hire.");
      const tasks = (templateTasksQuery.data ?? []).filter((t) => t.template_id === templateId);
      if (!tasks.length) throw new Error("This template has no tasks yet.");
      const base = joining ? new Date(`${joining}T00:00:00`) : new Date();
      const rows = tasks.map((t) => {
        const due = new Date(base);
        due.setDate(due.getDate() + (t.due_in_days ?? 0));
        return {
          employee_id: employeeId,
          title: t.title,
          owner: t.owner ?? "hr",
          due_date: due.toISOString().slice(0, 10),
          status: "pending",
        };
      });
      const { error } = await supabase.from("onboarding_tasks").insert(rows);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "onboarding.template_applied",
        entity: "onboarding_templates",
        entityId: templateId,
        next: { employeeId, tasks: rows.length },
      });
    },
    onSuccess: () => {
      toast.success("Template applied — onboarding tasks created");
      setApplyFor(null);
      void queryClient.invalidateQueries({ queryKey: ["onboarding-tasks"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The template could not be applied."),
  });

  if (!canAccess("onboarding", roles, permissions))
    return <NoPermissionState what="onboarding information" />;
  if (tasksQuery.isLoading) return <LoadingState rows={6} />;
  if (tasksQuery.isError) return <ErrorState message="Unable to load onboarding tasks." />;

  const tasks = tasksQuery.data ?? [];
  const names = nameMap(employeesQuery.data ?? []);
  const byEmployee = new Map<string, typeof tasks>();
  tasks.forEach((t) => {
    const key = t.employee_id ?? "unassigned";
    const list = byEmployee.get(key) ?? [];
    list.push(t);
    byEmployee.set(key, list);
  });

  const overdue = tasks.filter((t) => t.status !== "completed" && (daysUntil(t.due_date) ?? 1) < 0);
  const completed = tasks.filter((t) => t.status === "completed").length;
  const canEdit = isHr(roles) || isManager(roles);

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="New-hire journeys, task ownership and overdue steps."
        actions={
          canEdit ? (
            <div className="flex gap-2">
              <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">New template</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create onboarding template</DialogTitle>
                  </DialogHeader>
                  <form
                    id="template-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      createTemplate.mutate(
                        Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>,
                      );
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="name">Template name</Label>
                      <Input id="name" name="name" required placeholder="Standard hire" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="description">Description</Label>
                      <Input id="description" name="description" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tasks">Tasks (one per line)</Label>
                      <Textarea
                        id="tasks"
                        name="tasks"
                        rows={6}
                        placeholder="Collect signed contract&#10;Create accounts and access&#10;Assign buddy and manager"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Task due dates default to joining date + task order in days.
                    </p>
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="template-form" disabled={createTemplate.isPending}>
                      {createTemplate.isPending ? "Saving..." : "Create template"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button>Assign task</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Assign onboarding task</DialogTitle>
                  </DialogHeader>
                  <form
                    id="onboarding-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      createTask.mutate(Object.fromEntries(fd) as Record<string, string>);
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="title">Task</Label>
                      <Input
                        id="title"
                        name="title"
                        required
                        placeholder="Collect signed contract"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="owner">Owner</Label>
                        <Input id="owner" name="owner" defaultValue="hr" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="due_date">Due date</Label>
                        <Input id="due_date" name="due_date" type="date" />
                      </div>
                    </div>
                    <NewHirePicker
                      employees={(employeesQuery.data ?? []).map((e) => ({
                        id: e.id,
                        name: `${e.first_name} ${e.last_name}`,
                      }))}
                    />
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="onboarding-form" disabled={createTask.isPending}>
                      {createTask.isPending ? "Assigning..." : "Assign task"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="New hires in progress" value={byEmployee.size} />
        <StatCard label="Tasks" value={tasks.length} />
        <StatCard label="Completed" value={completed} tone="success" />
        <StatCard label="Overdue" value={overdue.length} tone="destructive" />
      </div>

      {overdue.length ? (
        <SectionCard title="Overdue tasks" className="mt-6">
          <ul className="space-y-2">
            {overdue.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3"
              >
                <div>
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {names.get(t.employee_id ?? "") ?? "New hire"} · due {t.due_date} · owner{" "}
                    {t.owner ?? "hr"}
                  </p>
                </div>
                {canEdit ? (
                  <Button size="sm" variant="outline" onClick={() => complete.mutate(t.id)}>
                    Mark done
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <div className="mt-6 space-y-4">
        {byEmployee.size === 0 ? (
          <EmptyState title="No onboarding journeys in progress." />
        ) : (
          [...byEmployee.entries()].map(([empId, list]) => {
            const done = list.filter((t) => t.status === "completed").length;
            const pct = Math.round((done / list.length) * 100);
            return (
              <SectionCard
                key={empId}
                title={names.get(empId) ?? "New hire"}
                description={`${done} of ${list.length} tasks complete`}
              >
                <Progress value={pct} className="h-2" />
                <ul className="mt-4 space-y-2">
                  {list.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.title}</p>
                        <p className="text-xs text-muted-foreground">
                          due {t.due_date ?? "—"} · owner {t.owner ?? "hr"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={t.status} />
                        {(canEdit || employee?.id === (t.employee_id ?? "")) &&
                        t.status !== "completed" ? (
                          <Button size="sm" variant="outline" onClick={() => complete.mutate(t.id)}>
                            Done
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            );
          })
        )}
      </div>

      <SectionCard title="Templates" className="mt-6">
        {templatesQuery.isLoading ? (
          <LoadingState rows={2} />
        ) : (templatesQuery.data ?? []).length === 0 ? (
          <EmptyState
            title="No templates yet."
            description="Create a reusable set of onboarding tasks for new hires."
          />
        ) : (
          <ul className="space-y-4">
            {(templatesQuery.data ?? []).map((t) => {
              const tTasks = (templateTasksQuery.data ?? []).filter(
                (tt) => tt.template_id === t.id,
              );
              return (
                <li key={t.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{t.name}</p>
                        {t.is_default ? <StatusBadge status="default" /> : null}
                      </div>
                      {t.description ? (
                        <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                      ) : null}
                    </div>
                    {canEdit ? (
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTaskForTemplate(t.id)}
                        >
                          Add task
                        </Button>
                        <Button size="sm" onClick={() => setApplyFor(t.id)}>
                          Apply
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {tTasks.length ? (
                    <ul className="mt-3 space-y-1.5">
                      {tTasks.map((tt) => (
                        <li
                          key={tt.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                        >
                          <span>
                            {tt.title}
                            <span className="text-muted-foreground"> · {tt.owner ?? "hr"}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">+{tt.due_in_days}d</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">
                      No tasks on this template yet.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <Dialog
        open={taskForTemplate !== null}
        onOpenChange={(o) => {
          if (!o) setTaskForTemplate(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add template task</DialogTitle>
          </DialogHeader>
          <form
            id="template-task-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              addTemplateTask.mutate(
                Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>,
              );
            }}
          >
            <input type="hidden" name="template_id" value={taskForTemplate ?? ""} />
            <div className="space-y-1.5">
              <Label htmlFor="title">Task</Label>
              <Input id="title" name="title" required placeholder="Schedule day-one orientation" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="owner">Owner</Label>
                <Input id="owner" name="owner" defaultValue="hr" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="due_in_days">Due in (days from joining)</Label>
                <Input id="due_in_days" name="due_in_days" type="number" min={0} defaultValue="0" />
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="template-task-form" disabled={addTemplateTask.isPending}>
              {addTemplateTask.isPending ? "Adding..." : "Add task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={applyFor !== null}
        onOpenChange={(o) => {
          if (!o) setApplyFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply template</DialogTitle>
          </DialogHeader>
          <form
            id="apply-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              applyTemplate.mutate(
                Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>,
              );
            }}
          >
            <input type="hidden" name="template_id" value={applyFor ?? ""} />
            <p className="text-sm text-muted-foreground">
              Template: {(templatesQuery.data ?? []).find((t) => t.id === applyFor)?.name ?? "—"}
            </p>
            <NewHirePicker
              employees={(employeesQuery.data ?? []).map((e) => ({
                id: e.id,
                name: `${e.first_name} ${e.last_name}`,
              }))}
            />
            <div className="space-y-1.5">
              <Label htmlFor="joining_date">Joining date</Label>
              <Input id="joining_date" name="joining_date" type="date" />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="apply-form" disabled={applyTemplate.isPending}>
              {applyTemplate.isPending ? "Applying..." : "Apply template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewHirePicker({ employees }: { employees: { id: string; name: string }[] }) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-1.5">
      <Label>New hire</Label>
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
