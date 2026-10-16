import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GraduationCap, Plus } from "lucide-react";
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
import { fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, hasPermission, isHr } from "@/lib/rbac";

export const Route = createFileRoute("/_app/training")({
  head: () => ({
    meta: [
      { title: "Training — Spine AI" },
      {
        name: "description",
        content: "Programs, sessions and enrollment progress for learning across your workforce.",
      },
      { property: "og:title", content: "Training — Spine AI" },
      { property: "og:description", content: "Learning programs and enrollments." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TrainingPage,
});

function TrainingPage() {
  const { roles, permissions, user, employee } = useAuth();
  const queryClient = useQueryClient();
  const hr = isHr(roles);
  const canManage = hasPermission(roles, permissions, "manage_training");
  const [open, setOpen] = useState(false);
  const [enrollProgram, setEnrollProgram] = useState<string | null>(null);
  const [sessionFor, setSessionFor] = useState<string | null>(null);
  const [completeFor, setCompleteFor] = useState<string | null>(null);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const programsQuery = useQuery({
    queryKey: ["training-programs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_programs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const sessionsQuery = useQuery({
    queryKey: ["training-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("training_sessions")
        .select("*")
        .order("starts_on");
      if (error) throw error;
      return data ?? [];
    },
  });
  const enrollmentsQuery = useQuery({
    queryKey: ["training-enrollments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_trainings")
        .select("*")
        .order("enrolled_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const addProgram = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { data, error } = await supabase
        .from("training_programs")
        .insert({
          title: String(form["title"]),
          category: String(form["category"] ?? "skills"),
          mode: String(form["mode"] ?? "online"),
          duration_hours: Number(form["duration_hours"]) || null,
          provider: String(form["provider"] ?? "") || null,
          external_url: String(form["external_url"] ?? "") || null,
          description: String(form["description"] ?? "") || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "training.program_created",
        entity: "training_programs",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Training program created");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["training-programs"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The program could not be created."),
  });

  const addSession = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { data, error } = await supabase
        .from("training_sessions")
        .insert({
          program_id: String(form["program_id"]),
          title: String(form["title"]),
          starts_on: String(form["starts_on"] || "") || null,
          ends_on: String(form["ends_on"] || "") || null,
          instructor: String(form["instructor"] ?? "") || null,
          location: String(form["location"] ?? "") || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "training.session_created",
        entity: "training_sessions",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Session scheduled");
      setSessionFor(null);
      void queryClient.invalidateQueries({ queryKey: ["training-sessions"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The session could not be created."),
  });

  const enroll = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const programId = enrollProgram;
      if (!programId) throw new Error("No program selected.");
      const { data, error } = await supabase
        .from("employee_trainings")
        .insert({
          program_id: programId,
          employee_id: String(form["employee_id"]),
          enrolled_by: user?.id ?? null,
          status: "enrolled",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "training.enrolled",
        entity: "employee_trainings",
        entityId: data.id,
      });
    },
    onSuccess: () => {
      toast.success("Employee enrolled");
      setEnrollProgram(null);
      void queryClient.invalidateQueries({ queryKey: ["training-enrollments"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The enrollment could not be saved."),
  });

  const complete = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const id = completeFor;
      if (!id) throw new Error("No enrollment selected.");
      const { error } = await supabase
        .from("employee_trainings")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          score: Number(form["score"]) || null,
          certificate: String(form["certificate"] ?? "") || null,
        })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "training.completed",
        entity: "employee_trainings",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Training completed");
      setCompleteFor(null);
      void queryClient.invalidateQueries({ queryKey: ["training-enrollments"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "The completion could not be saved."),
  });

  if (!canAccess("training", roles, permissions))
    return <NoPermissionState what="training information" />;
  if (programsQuery.isLoading) return <LoadingState rows={6} />;
  if (programsQuery.isError) return <ErrorState message="Unable to load training data." />;

  const names = nameMap(employeesQuery.data ?? []);
  const programs = programsQuery.data ?? [];
  const sessions = sessionsQuery.data ?? [];
  const enrollments = enrollmentsQuery.data ?? [];
  const mine = employee ? enrollments.filter((e) => e.employee_id === employee.id) : [];
  const visibleEnrollments = hr ? enrollments : mine;
  const sessionsByProgram = new Map<string, typeof sessions>();
  sessions.forEach((s) => {
    const list = sessionsByProgram.get(s.program_id) ?? [];
    list.push(s);
    sessionsByProgram.set(s.program_id, list);
  });
  const programById = new Map(programs.map((p) => [p.id, p]));
  const active = programs.filter((p) => p.status !== "archived").length;
  const enrolled = enrollments.filter((e) => e.status === "enrolled").length;
  const completedCount = enrollments.filter((e) => e.status === "completed").length;

  return (
    <>
      <PageHeader
        title="Training"
        description="Catalogs, sessions and completion tracking for learning programs."
        actions={
          canManage ? (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Add program
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add training program</DialogTitle>
                </DialogHeader>
                <form
                  id="program-form"
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addProgram.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input id="title" name="title" required placeholder="Leadership Essentials" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="category">Category</Label>
                      <Input id="category" name="category" defaultValue="skills" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Mode</Label>
                      <ModeSelect />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="duration_hours">Duration (hours)</Label>
                      <Input id="duration_hours" name="duration_hours" type="number" min={0} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="provider">Provider</Label>
                      <Input id="provider" name="provider" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="external_url">External URL</Label>
                    <Input id="external_url" name="external_url" type="url" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description">Description</Label>
                    <Textarea id="description" name="description" rows={3} />
                  </div>
                </form>
                <DialogFooter>
                  <Button type="submit" form="program-form" disabled={addProgram.isPending}>
                    {addProgram.isPending ? "Saving..." : "Add program"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Programs"
          value={programs.length}
          icon={<GraduationCap className="h-4 w-4" />}
        />
        <StatCard label="Active programs" value={active} tone="success" />
        <StatCard label="Enrolled" value={enrolled} />
        <StatCard label="Completed" value={completedCount} tone="success" />
      </div>

      <SectionCard title="Programs" className="mt-6">
        {programs.length === 0 ? (
          <EmptyState title="No training programs yet." />
        ) : (
          <ul className="space-y-4">
            {programs.map((p) => {
              const sessionsForProgram = sessionsByProgram.get(p.id) ?? [];
              return (
                <li key={p.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <p className="font-medium">{p.title}</p>
                        <StatusBadge status={p.status} />
                      </div>
                      <p className="mt-1 text-xs capitalize text-muted-foreground">
                        {p.category.replace("_", " ")} · {p.mode.replace("_", " ")}
                        {p.duration_hours ? ` · ${p.duration_hours}h` : ""}
                        {p.provider ? ` · ${p.provider}` : ""}
                      </p>
                      {p.description ? (
                        <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <div className="flex shrink-0 gap-2">
                        <Button size="sm" variant="outline" onClick={() => setSessionFor(p.id)}>
                          Schedule session
                        </Button>
                        <Button size="sm" onClick={() => setEnrollProgram(p.id)}>
                          Enroll
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  {sessionsForProgram.length ? (
                    <ul className="mt-3 space-y-1.5">
                      {sessionsForProgram.map((s) => (
                        <li
                          key={s.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                        >
                          <span>
                            {s.title}
                            {s.starts_on ? ` · ${s.starts_on}` : ""}
                            {s.instructor ? ` · ${s.instructor}` : ""}
                          </span>
                          {s.location ? (
                            <span className="text-xs text-muted-foreground">{s.location}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title={hr ? "Enrollments" : "My training"} className="mt-6">
        {visibleEnrollments.length === 0 ? (
          <EmptyState title="No enrollments yet." />
        ) : (
          <ul className="space-y-3">
            {visibleEnrollments.map((e) => (
              <li key={e.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {programById.get(e.program_id)?.title ?? "Program"}{" "}
                      <span className="text-muted-foreground">
                        · {names.get(e.employee_id) ?? "—"}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Enrolled {new Date(e.enrolled_at).toLocaleDateString()}
                      {e.completed_at
                        ? ` · completed ${new Date(e.completed_at).toLocaleDateString()}`
                        : ""}
                      {e.score != null ? ` · score ${e.score}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={e.status} />
                    {canManage && e.status === "enrolled" ? (
                      <Button size="sm" variant="outline" onClick={() => setCompleteFor(e.id)}>
                        Mark complete
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <Dialog
        open={enrollProgram !== null}
        onOpenChange={(o) => {
          if (!o) setEnrollProgram(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enroll employee</DialogTitle>
          </DialogHeader>
          <form
            id="enroll-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              enroll.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
            }}
          >
            <input type="hidden" name="program_id" value={enrollProgram ?? ""} />
            <p className="text-sm text-muted-foreground">
              Program: {enrollProgram ? (programById.get(enrollProgram)?.title ?? "—") : "—"}
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
          </form>
          <DialogFooter>
            <Button type="submit" form="enroll-form" disabled={enroll.isPending}>
              {enroll.isPending ? "Enrolling..." : "Enroll"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={sessionFor !== null}
        onOpenChange={(o) => {
          if (!o) setSessionFor(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule session</DialogTitle>
          </DialogHeader>
          <form
            id="session-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              addSession.mutate(Object.fromEntries(new FormData(e.currentTarget).entries()));
            }}
          >
            <input type="hidden" name="program_id" value={sessionFor ?? ""} />
            <div className="space-y-1.5">
              <Label htmlFor="title">Session title</Label>
              <Input id="title" name="title" required />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="starts_on">Starts</Label>
                <Input id="starts_on" name="starts_on" type="date" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ends_on">Ends</Label>
                <Input id="ends_on" name="ends_on" type="date" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="instructor">Instructor</Label>
                <Input id="instructor" name="instructor" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="location">Location</Label>
                <Input id="location" name="location" />
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="session-form" disabled={addSession.isPending}>
              {addSession.isPending ? "Scheduling..." : "Schedule session"}
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
            <DialogTitle>Complete training</DialogTitle>
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
              <Label htmlFor="score">Score (optional)</Label>
              <Input id="score" name="score" type="number" min={0} max={100} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="certificate">Certificate</Label>
              <Input
                id="certificate"
                name="certificate"
                placeholder="Certificate URL or reference"
              />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="complete-form" disabled={complete.isPending}>
              {complete.isPending ? "Saving..." : "Mark complete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ModeSelect() {
  const [value, setValue] = useState("online");
  return (
    <>
      <input type="hidden" name="mode" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="online">Online</SelectItem>
          <SelectItem value="instructor_led">Instructor-led</SelectItem>
          <SelectItem value="hybrid">Hybrid</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}
