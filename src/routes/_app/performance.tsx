import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarRange, Plus, Star } from "lucide-react";

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
import { fetchEmployees, logAudit, nameMap } from "@/lib/hr-queries";
import { canAccess, isManager } from "@/lib/rbac";
import { submitSelfReview } from "@/lib/performance.functions";

export const Route = createFileRoute("/_app/performance")({
  head: () => ({
    meta: [
      { title: "Performance — Spine AI" },
      {
        name: "description",
        content: "Goals, review cycles, self-reviews and finalization workflows.",
      },
      { property: "og:title", content: "Performance — Spine AI" },
      { property: "og:description", content: "Goals, reviews and development planning." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PerformancePage,
});

function EmployeeSelect({
  options,
  name,
  required,
  names,
}: {
  options: { id: string }[];
  name: string;
  required?: boolean;
  names: Map<string, string>;
}) {
  const [value, setValue] = useState("");
  return (
    <>
      <input type="hidden" name={name} value={value} required={required} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder="Select employee" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {names.get(o.id) ?? "—"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function PerformancePage() {
  const { roles, permissions, employee, user } = useAuth();
  const queryClient = useQueryClient();
  const manager = isManager(roles);
  const [goalOpen, setGoalOpen] = useState(false);
  const [cycleOpen, setCycleOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selfOpen, setSelfOpen] = useState(false);
  const [selfReviewId, setSelfReviewId] = useState<string | null>(null);

  const employeesQuery = useQuery({ queryKey: ["employees"], queryFn: fetchEmployees });
  const goalsQuery = useQuery({
    queryKey: ["goals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("goals")
        .select("id, employee_id, title, description, due_date, progress, status, cycle_id")
        .order("due_date");
      if (error) throw error;
      return data ?? [];
    },
  });
  const reviewsQuery = useQuery({
    queryKey: ["reviews"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_reviews")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const cyclesQuery = useQuery({
    queryKey: ["performance-cycles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_cycles")
        .select("*")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const addGoal = useMutation({
    mutationFn: async (form: {
      title: string;
      description: string;
      due_date: string;
      cycle_id: string;
    }) => {
      if (!employee) throw new Error("no employee");
      const { error } = await supabase.from("goals").insert({
        employee_id: employee.id,
        title: form.title,
        description: form.description,
        due_date: form.due_date || null,
        cycle_id: form.cycle_id || null,
      });
      if (error) throw error;
      await logAudit({ userId: user?.id, action: "goal.created", entity: "goals", next: form });
    },
    onSuccess: () => {
      toast.success("Goal added");
      setGoalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: () => toast.error("The goal could not be saved. Please try again."),
  });

  const updateProgress = useMutation({
    mutationFn: async ({ id, progress }: { id: string; progress: number }) => {
      const { error } = await supabase
        .from("goals")
        .update({ progress, status: progress >= 100 ? "completed" : "in_progress" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["goals"] }),
    onError: () => toast.error("You do not have permission to update this goal."),
  });

  const createCycle = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const { error } = await supabase.from("performance_cycles").insert({
        name: String(form["name"]),
        period: String(form["period"]),
        start_date: String(form["start_date"]),
        end_date: (String(form["end_date"] || "") || null) as string | null,
        review_start_date: (String(form["review_start_date"] || "") || null) as string | null,
        review_end_date: (String(form["review_end_date"] || "") || null) as string | null,
        self_review_required: form["self_review_required"] !== undefined,
        status: "active",
      });
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "cycle.created",
        entity: "performance_cycles",
        next: form,
      });
    },
    onSuccess: () => {
      toast.success("Review cycle created");
      setCycleOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["performance-cycles"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create cycle"),
  });

  const saveReview = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      const rating = Number(form["rating"]) || null;
      const payload = {
        employee_id: String(form["employee_id"]),
        period: String(form["period"]),
        rating,
        strengths: String(form["strengths"] ?? ""),
        improvements: String(form["improvements"] ?? ""),
        summary: String(form["summary"] ?? ""),
        status: "completed",
        submitted_at: new Date().toISOString(),
        reviewer_id: employee?.id ?? null,
      };
      const { data, error } = await supabase
        .from("performance_reviews")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "review.completed",
        entity: "performance_reviews",
        entityId: data.id as string,
      });
    },
    onSuccess: () => {
      toast.success("Review saved");
      setReviewOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["reviews"] });
    },
    onError: (e) =>
      toast.error(
        e instanceof Error ? e.message : "You do not have permission to save this review.",
      ),
  });

  const finalizeReview = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("performance_reviews")
        .update({
          status: "finalized",
          finalized_at: new Date().toISOString(),
          finalized_by: employee?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
      await logAudit({
        userId: user?.id,
        action: "review.finalized",
        entity: "performance_reviews",
        entityId: id,
      });
    },
    onSuccess: () => {
      toast.success("Review finalized");
      void queryClient.invalidateQueries({ queryKey: ["reviews"] });
    },
    onError: () => toast.error("Only managers and HR can finalize reviews."),
  });

  const selfReview = useMutation({
    mutationFn: async (form: Record<string, FormDataEntryValue>) => {
      if (!selfReviewId) throw new Error("No review selected.");
      return submitSelfReview({
        data: {
          reviewId: selfReviewId,
          selfRating: Number(form["self_rating"]) || 3,
          selfStrengths: String(form["self_strengths"] ?? ""),
          selfImprovements: String(form["self_improvements"] ?? ""),
          selfSummary: String(form["self_summary"] ?? ""),
        },
      });
    },
    onSuccess: () => {
      toast.success("Self-review submitted");
      setSelfOpen(false);
      setSelfReviewId(null);
      void queryClient.invalidateQueries({ queryKey: ["reviews"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Self-review could not be submitted."),
  });

  if (!canAccess("performance", roles, permissions))
    return <NoPermissionState what="performance information" />;
  if (goalsQuery.isLoading) return <LoadingState rows={6} />;
  if (goalsQuery.isError) return <ErrorState message="Unable to load performance data." />;

  const names = nameMap(employeesQuery.data ?? []);
  const goals = goalsQuery.data ?? [];
  const reviews = reviewsQuery.data ?? [];
  const cycles = cyclesQuery.data ?? [];
  const avg = reviews.length
    ? (reviews.reduce((s, r) => s + Number(r.rating ?? 0), 0) / reviews.length).toFixed(2)
    : "—";
  const completed = goals.filter((g) => g.status === "completed").length;
  const finalized = reviews.filter((r) => r.status === "finalized").length;
  const activeCycle = cycles.find((c) => c.status === "active");
  const cycleReviews = activeCycle ? reviews.filter((r) => r.cycle_id === activeCycle.id) : [];
  const cycleProgress = activeCycle?.review_end_date
    ? Math.min(100, Math.round((cycleReviews.length / (employeesQuery.data?.length ?? 1)) * 100))
    : 0;
  const myReview = employee ? reviews.find((r) => r.employee_id === employee.id) : undefined;

  const strengthThemes = topWords(reviews.map((r) => r.strengths ?? "").join(" "));
  const growthThemes = topWords(reviews.map((r) => r.improvements ?? "").join(" "));

  return (
    <>
      <PageHeader
        title="Performance"
        description="Goals, review cycles, self-review and finalization workflows across your authorized scope."
        actions={
          <div className="flex gap-2">
            {employee ? (
              <Dialog open={goalOpen} onOpenChange={setGoalOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" /> Add goal
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add a goal</DialogTitle>
                  </DialogHeader>
                  <form
                    id="goal-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      addGoal.mutate({
                        title: String(fd.get("title")),
                        description: String(fd.get("description") ?? ""),
                        due_date: String(fd.get("due_date") ?? ""),
                        cycle_id: String(fd.get("cycle_id") ?? ""),
                      });
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="title">Goal</Label>
                      <Input id="title" name="title" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="description">Description</Label>
                      <Textarea id="description" name="description" rows={3} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="due_date">Due date</Label>
                        <Input id="due_date" name="due_date" type="date" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cycle_id">Review cycle</Label>
                        <CycleSelect cycles={cycles} />
                      </div>
                    </div>
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="goal-form" disabled={addGoal.isPending}>
                      Save goal
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null}
            {manager ? (
              <Dialog open={cycleOpen} onOpenChange={setCycleOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <CalendarRange className="mr-2 h-4 w-4" /> New cycle
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create review cycle</DialogTitle>
                  </DialogHeader>
                  <form
                    id="cycle-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      createCycle.mutate(Object.fromEntries(fd.entries()));
                    }}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="name">Cycle name</Label>
                        <Input
                          id="name"
                          name="name"
                          required
                          placeholder="H1 2026 Performance Review"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="period">Period</Label>
                        <Input id="period" name="period" required placeholder="H1 2026" />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="start_date">Starts</Label>
                        <Input id="start_date" name="start_date" type="date" required />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="end_date">Ends</Label>
                        <Input id="end_date" name="end_date" type="date" />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="review_start_date">Review window starts</Label>
                        <Input id="review_start_date" name="review_start_date" type="date" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="review_end_date">Review window ends</Label>
                        <Input id="review_end_date" name="review_end_date" type="date" />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="self_review_required" defaultChecked />
                      Self-review required
                    </label>
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="cycle-form" disabled={createCycle.isPending}>
                      Create cycle
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Active goals" value={goals.length - completed} />
        <StatCard label="Completed goals" value={completed} tone="success" />
        <StatCard label="Reviews" value={reviews.length} />
        <StatCard label="Finalized" value={finalized} />
        <StatCard label="Average rating" value={avg} />
      </div>

      {myReview && !myReview.finalized_at && (
        <SectionCard className="mt-6" title="My self-review">
          {myReview.self_submitted_at ? (
            <p className="text-sm text-muted-foreground">
              Submitted {new Date(myReview.self_submitted_at).toLocaleDateString()} · awaiting
              manager review.
            </p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Complete your self-review for{" "}
                <span className="font-medium text-foreground">{myReview.period}</span> before the
                final review.
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setSelfReviewId(myReview.id);
                  setSelfOpen(true);
                }}
              >
                <Star className="mr-2 h-4 w-4" /> Submit self-review
              </Button>
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard
        className="ai-surface mt-6"
        title="AI performance themes"
        description="Recurring strengths and development areas across completed reviews"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-medium">Recurring strengths</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {strengthThemes.length ? strengthThemes.join(", ") : "Not enough review data yet."}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Development areas</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {growthThemes.length ? growthThemes.join(", ") : "Not enough review data yet."}
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Suggestion only — final performance decisions stay with managers and HR.
        </p>
      </SectionCard>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <SectionCard title="Goals">
          {goals.length === 0 ? (
            <EmptyState title="No goals recorded." />
          ) : (
            <ul className="space-y-4">
              {goals.map((g) => (
                <li key={g.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{g.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {names.get(g.employee_id) ?? "—"} · due {g.due_date ?? "—"}
                      </p>
                    </div>
                    <StatusBadge status={g.status} />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Progress value={g.progress} className="h-2" />
                    <span className="w-10 text-right text-xs text-muted-foreground">
                      {g.progress}%
                    </span>
                  </div>
                  {(isManager(roles) || employee?.id === g.employee_id) &&
                  g.status !== "completed" ? (
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          updateProgress.mutate({
                            id: g.id,
                            progress: Math.min(100, g.progress + 10),
                          })
                        }
                      >
                        +10% progress
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateProgress.mutate({ id: g.id, progress: 100 })}
                      >
                        Mark complete
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Reviews"
          actions={
            manager ? (
              <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus className="mr-1.5 h-4 w-4" /> Write review
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Write performance review</DialogTitle>
                  </DialogHeader>
                  <form
                    id="review-form"
                    className="space-y-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      saveReview.mutate(Object.fromEntries(fd.entries()));
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label>Employee</Label>
                      <EmployeeSelect
                        options={employeesQuery.data ?? []}
                        name="employee_id"
                        required
                        names={names}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="period">Period</Label>
                        <Input
                          id="period"
                          name="period"
                          defaultValue={activeCycle?.period ?? ""}
                          required
                          placeholder="H1 2026"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="rating">Rating (1–5)</Label>
                        <Input
                          id="rating"
                          name="rating"
                          type="number"
                          min={1}
                          max={5}
                          step={0.1}
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="strengths">Strengths</Label>
                      <Textarea id="strengths" name="strengths" rows={3} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="improvements">Improvements</Label>
                      <Textarea id="improvements" name="improvements" rows={3} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="summary">Summary</Label>
                      <Textarea id="summary" name="summary" rows={3} />
                    </div>
                  </form>
                  <DialogFooter>
                    <Button type="submit" form="review-form" disabled={saveReview.isPending}>
                      Save review
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : null
          }
        >
          {reviews.length === 0 ? (
            <EmptyState title="No reviews available." />
          ) : (
            <ul className="space-y-3">
              {reviews.map((r) => (
                <li key={r.id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Button asChild variant="link" className="h-auto p-0 font-medium">
                        <Link to="/employees/$employeeId" params={{ employeeId: r.employee_id }}>
                          {names.get(r.employee_id) ?? "Employee"}
                        </Link>
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        {r.period} · rating {r.rating ?? "—"}
                      </p>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  {r.summary ? (
                    <p className="mt-2 text-sm text-muted-foreground">{r.summary}</p>
                  ) : null}
                  {manager && r.status !== "finalized" ? (
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => finalizeReview.mutate(r.id)}
                      >
                        Finalize
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Review cycles" className="mt-6">
        {cycles.length === 0 ? (
          <EmptyState title="No review cycles yet." />
        ) : (
          <div className="space-y-4">
            {cycles.map((c) => (
              <div key={c.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.period} · {c.start_date} → {c.end_date ?? "—"}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Progress value={cycleProgress} className="h-2" />
                  <span className="w-24 text-right text-xs text-muted-foreground">
                    {cycleProgress}% reviewed
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Dialog
        open={selfOpen}
        onOpenChange={(o) => {
          setSelfOpen(o);
          if (!o) setSelfReviewId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit self-review</DialogTitle>
          </DialogHeader>
          <form
            id="self-form"
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              selfReview.mutate(Object.fromEntries(fd.entries()));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="self_rating">Self rating (1–5)</Label>
              <Input
                id="self_rating"
                name="self_rating"
                type="number"
                min={1}
                max={5}
                step={0.1}
                defaultValue={3}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="self_strengths">What have you done well?</Label>
              <Textarea id="self_strengths" name="self_strengths" rows={3} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="self_improvements">Where can you improve?</Label>
              <Textarea id="self_improvements" name="self_improvements" rows={3} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="self_summary">Summary</Label>
              <Textarea id="self_summary" name="self_summary" rows={3} required />
            </div>
          </form>
          <DialogFooter>
            <Button type="submit" form="self-form" disabled={selfReview.isPending}>
              {selfReview.isPending ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function CycleSelect({ cycles }: { cycles: { id: string; name: string; period: string }[] }) {
  const [value, setValue] = useState("");
  return (
    <>
      <input type="hidden" name="cycle_id" value={value} />
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder="No cycle" />
        </SelectTrigger>
        <SelectContent>
          {cycles.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

const STOP = new Set([
  "and",
  "the",
  "with",
  "for",
  "of",
  "to",
  "a",
  "in",
  "on",
  "strong",
  "good",
  "needs",
  "more",
  "better",
  "of,",
]);

function topWords(text: string) {
  const counts = new Map<string, number>();
  text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 3 && !STOP.has(w))
    .forEach((w) => counts.set(w, (counts.get(w) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);
}
